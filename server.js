import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const app = express();
app.use(express.json({ limit: "32mb" }));
app.use(express.static(path.join(__dirname, "public")));

await fs.mkdir(DATA_DIR, { recursive: true });

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const docPath = (id) => path.join(DATA_DIR, `${id}.json`);

// ---------- Document storage API ----------

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// List saved documents (metadata only)
app.get("/api/docs", async (_req, res) => {
  try {
    const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
    const docs = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
        const stat = await fs.stat(path.join(DATA_DIR, f));
        docs.push({
          id: path.basename(f, ".json"),
          title: raw.title || "Untitled map",
          layout: raw.layout || "mindmap",
          updatedAt: stat.mtimeMs,
        });
      } catch {
        /* skip unreadable */
      }
    }
    docs.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: "Could not list documents." });
  }
});

app.get("/api/docs/:id", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "Bad id." });
  try {
    const raw = await fs.readFile(docPath(req.params.id), "utf8");
    res.type("application/json").send(raw);
  } catch {
    res.status(404).json({ error: "Map not found." });
  }
});

// Create or overwrite (idempotent by id)
app.put("/api/docs/:id", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "Bad id." });
  const doc = req.body;
  if (!doc || typeof doc !== "object" || !doc.root)
    return res.status(400).json({ error: "A map needs a root topic." });
  doc.id = req.params.id;
  try {
    await fs.writeFile(docPath(req.params.id), JSON.stringify(doc), "utf8");
    res.json({ id: req.params.id, savedAt: Date.now() });
  } catch {
    res.status(500).json({ error: "Could not save map." });
  }
});

app.post("/api/docs", async (req, res) => {
  const id = crypto.randomUUID();
  const doc = req.body && req.body.root ? req.body : null;
  if (!doc) return res.status(400).json({ error: "A map needs a root topic." });
  doc.id = id;
  try {
    await fs.writeFile(docPath(id), JSON.stringify(doc), "utf8");
    res.json({ id });
  } catch {
    res.status(500).json({ error: "Could not create map." });
  }
});

app.delete("/api/docs/:id", async (req, res) => {
  if (!safeId(req.params.id)) return res.status(400).json({ error: "Bad id." });
  try {
    await fs.unlink(docPath(req.params.id));
    res.json({ deleted: req.params.id });
  } catch {
    res.status(404).json({ error: "Map not found." });
  }
});

// ---------- Export (raster + PDF) ----------

// Minimal 24-bit BMP encoder (bottom-up), compositing alpha over white.
function encodeBMP(rgba, width, height) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);
  buf.write("BM", 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive => bottom-up
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    let p = 54 + row * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      buf[p++] = Math.round(rgba[i + 2] * a + 255 * (1 - a)); // B
      buf[p++] = Math.round(rgba[i + 1] * a + 255 * (1 - a)); // G
      buf[p++] = Math.round(rgba[i] * a + 255 * (1 - a)); // R
    }
  }
  return buf;
}

const MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  tiff: "image/tiff",
  bmp: "image/bmp",
  pdf: "application/pdf",
};

app.post("/api/export", async (req, res) => {
  const { svg, format = "png", scale = 2, background = "#ffffff" } = req.body || {};
  if (!svg || typeof svg !== "string")
    return res.status(400).json({ error: "Nothing to export." });
  const fmt = String(format).toLowerCase();
  const density = Math.max(72, Math.min(288, 72 * Number(scale || 2)));
  const svgBuf = Buffer.from(svg, "utf8");

  try {
    if (fmt === "png") {
      const out = await sharp(svgBuf, { density }).png().toBuffer();
      return send(out, "png");
    }
    if (fmt === "jpeg" || fmt === "jpg") {
      const out = await sharp(svgBuf, { density })
        .flatten({ background })
        .jpeg({ quality: 92 })
        .toBuffer();
      return send(out, "jpeg");
    }
    if (fmt === "gif") {
      const out = await sharp(svgBuf, { density }).gif().toBuffer();
      return send(out, "gif");
    }
    if (fmt === "tiff") {
      const out = await sharp(svgBuf, { density }).tiff().toBuffer();
      return send(out, "tiff");
    }
    if (fmt === "bmp") {
      const { data, info } = await sharp(svgBuf, { density })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return send(encodeBMP(data, info.width, info.height), "bmp");
    }
    if (fmt === "pdf") {
      const png = await sharp(svgBuf, { density }).png().toBuffer();
      const meta = await sharp(png).metadata();
      const doc = new PDFDocument({
        size: [meta.width, meta.height],
        margin: 0,
      });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => send(Buffer.concat(chunks), "pdf"));
      doc.image(png, 0, 0, { width: meta.width, height: meta.height });
      doc.end();
      return;
    }
    return res.status(400).json({ error: `Unsupported format: ${fmt}` });
  } catch (err) {
    console.error("Export failed:", err);
    return res.status(500).json({ error: "Export failed while rendering the image." });
  }

  function send(buf, ext) {
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="mindmap.${ext}"`);
    res.send(buf);
  }
});

app.listen(PORT, () => {
  console.log(`Blumind Web running on http://localhost:${PORT}`);
  console.log(`Storing maps in ${DATA_DIR}`);
});
