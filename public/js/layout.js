// Pure layout engine. Given a document and a size lookup for each node,
// returns a Map of nodeId -> { x, y, w, h, depth, side } in model coordinates.
// Supports four layouts; switching is just a different call, so a map can be
// re-shaped with one click (a hallmark Blumind feature).

export function computeLayout(doc, getSize) {
  const root = doc.root;
  const layout = doc.layout || "mindmap";
  const pos = new Map();

  // index every node so we can look up by id during packing
  const byId = new Map();
  (function index(n) {
    byId.set(n.id, n);
    (n.children || []).forEach(index);
  })(root);

  const vis = (n) => (n.collapsed ? [] : n.children || []);
  const W = (n) => getSize(n).w;
  const H = (n) => getSize(n).h;
  const node = (id) => byId.get(id);

  // Pack a forest along a "cross" axis using each node's cross-size; parents
  // are centered over their visible children. Returns id -> { cross, depth }.
  // With opts.grid, a large run of leaf-only siblings is packed into a grid
  // (several rows) instead of one very wide row.
  function tidy(roots, crossSizeOf, gapCross, opts = {}) {
    const grid = opts.grid;
    const out = new Map();
    let cursor = 0;
    function walk(n, depth) {
      const kids = vis(n);
      if (!kids.length) {
        const c = cursor + crossSizeOf(n) / 2;
        cursor += crossSizeOf(n) + gapCross;
        out.set(n.id, { cross: c, depth });
        return c;
      }
      if (grid && kids.length >= grid.min && kids.every((k) => vis(k).length === 0)) {
        const cols = Math.max(1, Math.min(kids.length, grid.colsFor(kids.length)));
        let colW = 0;
        for (const k of kids) colW = Math.max(colW, crossSizeOf(k));
        const start = cursor;
        const colCenter = [];
        for (let i = 0; i < cols; i++) colCenter[i] = start + i * (colW + gapCross) + colW / 2;
        cursor = start + cols * (colW + gapCross);
        kids.forEach((k, i) => {
          out.set(k.id, { cross: colCenter[i % cols], depth: depth + 1 + Math.floor(i / cols) });
        });
        const c = (colCenter[0] + colCenter[cols - 1]) / 2;
        out.set(n.id, { cross: c, depth });
        return c;
      }
      const cs = kids.map((k) => walk(k, depth + 1));
      const c = (cs[0] + cs[cs.length - 1]) / 2;
      out.set(n.id, { cross: c, depth });
      return c;
    }
    for (const r of roots) walk(r, 0);
    return out;
  }

  // For each depth, find the largest main-axis size and return the center
  // offset of each depth band (distance from the start of the first band).
  function bandCenters(tp, mainSizeOf, gapMain) {
    const maxByDepth = new Map();
    for (const [id, p] of tp) {
      const m = mainSizeOf(node(id));
      maxByDepth.set(p.depth, Math.max(maxByDepth.get(p.depth) || 0, m));
    }
    const depths = [...maxByDepth.keys()].sort((a, b) => a - b);
    const center = new Map();
    let acc = 0;
    for (const d of depths) {
      const band = maxByDepth.get(d);
      center.set(d, acc + band / 2);
      acc += band + gapMain;
    }
    return center;
  }

  const GAPX = 52; // gap between root and first branch (mind map)

  if (layout === "tree" || layout === "org") {
    const grid = { min: 6, colsFor: (k) => Math.ceil(Math.sqrt(k)) };
    const tp = tidy([root], W, 24, { grid }); // pack horizontally by width
    const bandY = bandCenters(tp, H, 56); // stack downward by height
    const shift = tp.get(root.id).cross; // anchor root at x = 0
    for (const [id, p] of tp) {
      const n = node(id);
      pos.set(id, {
        x: p.cross - shift,
        y: bandY.get(p.depth),
        w: W(n),
        h: H(n),
        depth: p.depth,
        side: "down",
      });
    }
  } else if (layout === "logic") {
    const tp = tidy([root], H, 16); // pack vertically by height
    const bandX = bandCenters(tp, W, 72); // grow rightward by width
    const shift = tp.get(root.id).cross; // anchor root at y = 0
    for (const [id, p] of tp) {
      const n = node(id);
      pos.set(id, {
        x: bandX.get(p.depth),
        y: p.cross - shift,
        w: W(n),
        h: H(n),
        depth: p.depth,
        side: "right",
      });
    }
  } else {
    // mind map: root centered, branches split to balance leaves
    const kids = vis(root);
    const { left, right } = splitSides(kids);
    pos.set(root.id, { x: 0, y: 0, w: W(root), h: H(root), depth: 0, side: "root" });
    placeSide(right, "right");
    placeSide(left, "left");

    function placeSide(branchRoots, side) {
      if (!branchRoots.length) return;
      const tp = tidy(branchRoots, H, 16);
      const bandX = bandCenters(tp, W, 72);
      let minC = Infinity;
      let maxC = -Infinity;
      for (const [, p] of tp) {
        minC = Math.min(minC, p.cross);
        maxC = Math.max(maxC, p.cross);
      }
      const mid = (minC + maxC) / 2;
      const rootHalf = W(root) / 2 + GAPX;
      for (const [id, p] of tp) {
        const n = node(id);
        const dist = rootHalf + bandX.get(p.depth);
        pos.set(id, {
          x: side === "right" ? dist : -dist,
          y: p.cross - mid,
          w: W(n),
          h: H(n),
          depth: p.depth + 1,
          side,
        });
      }
    }
  }

  return pos;

  function leafCount(n) {
    const k = vis(n);
    if (!k.length) return 1;
    return k.reduce((s, c) => s + leafCount(c), 0);
  }
  function splitSides(kids) {
    const left = [];
    const right = [];
    let lc = 0;
    let rc = 0;
    for (const k of kids) {
      const c = leafCount(k);
      if (rc <= lc) {
        right.push(k);
        rc += c;
      } else {
        left.push(k);
        lc += c;
      }
    }
    return { left, right };
  }
}
