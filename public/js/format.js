import { ICON_BY_ID } from "./icons.js";

export const uid = () => "n" + Math.random().toString(36).slice(2, 10);

export function newNode(text = "") {
  return {
    id: uid(),
    text,
    color: "",
    icon: "",
    progress: null,
    note: "",
    link: "",
    collapsed: false,
    children: [],
  };
}

// ---------- Download helpers ----------

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

// ---------- Outline / CSV / FreeMind ----------

export function toText(doc) {
  const lines = [];
  (function walk(n, depth) {
    const icon = n.icon && ICON_BY_ID[n.icon] ? ICON_BY_ID[n.icon] + " " : "";
    lines.push("  ".repeat(depth) + icon + (n.text || ""));
    if (n.note) lines.push("  ".repeat(depth + 1) + "» " + n.note.replace(/\n/g, " "));
    (n.children || []).forEach((c) => walk(c, depth + 1));
  })(doc.root, 0);
  return lines.join("\n");
}

export function toCSV(doc) {
  const rows = [["id", "parentId", "depth", "text", "icon", "progress", "note", "link", "color"]];
  (function walk(n, parentId, depth) {
    rows.push([
      n.id,
      parentId || "",
      depth,
      n.text || "",
      n.icon || "",
      n.progress == null ? "" : n.progress,
      n.note || "",
      n.link || "",
      n.color || "",
    ]);
    (n.children || []).forEach((c) => walk(c, n.id, depth + 1));
  })(doc.root, "", 0);
  const esc = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function toFreeMind(doc) {
  const out = ['<map version="1.0.1">'];
  (function walk(n, indent) {
    const pad = "  ".repeat(indent);
    const kids = n.children || [];
    const attrs = `TEXT="${xmlEsc(n.text || "")}"`;
    if (!kids.length && !n.note) {
      out.push(`${pad}<node ${attrs}/>`);
    } else {
      out.push(`${pad}<node ${attrs}>`);
      if (n.note)
        out.push(
          `${pad}  <richcontent TYPE="NOTE"><html><body><p>${xmlEsc(n.note)}</p></body></html></richcontent>`
        );
      kids.forEach((c) => walk(c, indent + 1));
      out.push(`${pad}</node>`);
    }
  })(doc.root, 1);
  out.push("</map>");
  return out.join("\n");
}

export function fromFreeMind(xml) {
  const dom = new DOMParser().parseFromString(xml, "text/xml");
  if (dom.querySelector("parsererror")) throw new Error("That .mm file could not be parsed.");
  const top = dom.querySelector("map > node");
  if (!top) throw new Error("No topics found in that FreeMind file.");
  const read = (el) => {
    const n = newNode(el.getAttribute("TEXT") || "");
    const note = el.querySelector(":scope > richcontent[TYPE='NOTE']");
    if (note) n.note = note.textContent.trim();
    el.querySelectorAll(":scope > node").forEach((child) => n.children.push(read(child)));
    return n;
  };
  return read(top);
}

export function fromJSON(text) {
  const data = JSON.parse(text);
  const root = data.root || data;
  if (!root || typeof root !== "object" || !("text" in root || "children" in root))
    throw new Error("That file is not a valid map.");
  // normalize so older/partial files get all fields
  const norm = (n) => {
    const base = newNode(n.text || "");
    Object.assign(base, {
      id: n.id || base.id,
      color: n.color || "",
      icon: n.icon || "",
      progress: typeof n.progress === "number" ? n.progress : null,
      note: n.note || "",
      link: n.link || "",
      collapsed: !!n.collapsed,
      children: (n.children || []).map(norm),
    });
    return base;
  };
  return {
    title: data.title || "Imported map",
    layout: data.layout || "mindmap",
    theme: data.theme || "blueprint",
    root: norm(root),
    links: Array.isArray(data.links) ? data.links : [],
  };
}

// ---------- Server-side raster / PDF export ----------

export async function exportRaster(svg, format, scale, background) {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ svg, format, scale, background }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Export failed.");
  }
  const blob = await res.blob();
  const ext = format === "jpeg" ? "jpg" : format;
  downloadBlob(blob, `mindmap.${ext}`);
}
