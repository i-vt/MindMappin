import { computeLayout } from "./layout.js";
import { THEMES } from "./themes.js";
import { ICON_BY_ID } from "./icons.js";
import { newNode } from "./format.js";
import { renderMarkdown } from "./markdown.js";

const SVGNS = "http://www.w3.org/2000/svg";
const FONT = 'Arial, "Liberation Sans", "Segoe UI", system-ui, sans-serif';
const FS = 13; // title font size
const LH = 17; // line height
const PAD = 10; // node padding
const MAXW = 240; // wrap width
const ICONW = 20; // icon column width

function el(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  for (const c of [].concat(kids))
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

export class MapView {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.doc = null;
    this.view = { x: 0, y: 0, scale: 1 };
    this.selectedId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.sizeCache = new Map();
    this.lastPos = new Map();
    this.linkMode = false;
    this._editing = false;
    this._buildDOM();
    this._bindEvents();
  }

  // ---------- DOM ----------
  _buildDOM() {
    this.host.classList.add("mv-host");
    this.svg = el("svg", { class: "mv-svg", tabindex: "0" });
    this.viewport = el("g", { class: "mv-viewport" });
    this.gEdges = el("g", { class: "mv-edges" });
    this.gLinks = el("g", { class: "mv-links" });
    this.gNodes = el("g", { class: "mv-nodes" });
    this.viewport.append(this.gEdges, this.gLinks, this.gNodes);
    this.measurer = el("text", { x: -9999, y: -9999, "font-family": FONT, "font-size": FS });
    this.svg.append(this.viewport, this.measurer);
    this.host.append(this.svg);
    this.editor = document.createElement("textarea");
    this.editor.className = "mv-editor";
    this.editor.spellcheck = false;
    this.editor.style.display = "none";
    this.host.append(this.editor);
    this.notePop = document.createElement("div");
    this.notePop.className = "mv-notepop";
    this.notePop.hidden = true;
    this.notePop.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.notePop.addEventListener("wheel", (e) => e.stopPropagation());
    this.host.append(this.notePop);
  }

  _bindEvents() {
    this.svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this._panning = true;
      this._draggedPan = false;
      this._panStart = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      this.svg.setPointerCapture(e.pointerId);
      this.svg.focus({ preventScroll: true });
      if (this._editing) this._endEdit(true);
      this._hideNote();
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!this._panning) return;
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this._draggedPan = true;
      this.view.x = this._panStart.vx + dx;
      this.view.y = this._panStart.vy + dy;
      this._applyTransform();
    });
    const endPan = (e) => {
      if (!this._panning) return;
      this._panning = false;
      try {
        this.svg.releasePointerCapture(e.pointerId);
      } catch {}
      if (!this._draggedPan) {
        if (this.linkMode) this._cancelLink();
        else this.select(null);
      }
    };
    this.svg.addEventListener("pointerup", endPan);
    this.svg.addEventListener("pointercancel", endPan);

    this.svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = this.svg.getBoundingClientRect();
        this._zoomAround(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false }
    );

    this.svg.addEventListener("keydown", (e) => this._onKey(e));

    this.editor.addEventListener("input", () => {
      this.liveText(this._editId, this.editor.value);
      const p = this.lastPos.get(this._editId);
      if (p) this._positionEditor(p);
    });
    this.editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const id = this._editId;
        this._endEdit(true);
        this.addSibling(id, true);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const id = this._editId;
        this._endEdit(true);
        this.addChild(id, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this._endEdit(false);
        this.svg.focus();
      }
    });
    this.editor.addEventListener("blur", () => {
      if (this._editing) this._endEdit(true);
    });
  }

  // ---------- Document & state ----------
  setDocument(doc, { resetView = true } = {}) {
    this.doc = doc;
    doc.links = doc.links || [];
    this.sizeCache.clear();
    this.selectedId = doc.root ? doc.root.id : null;
    this.undoStack = [];
    this.redoStack = [];
    this.render();
    if (resetView) this.fitToScreen();
    else this._applyTransform();
    this._emitSelect();
  }

  serializeState() {
    return {
      doc: this.doc,
      view: { ...this.view },
      selectedId: this.selectedId,
      undo: this.undoStack.slice(-60),
      redo: this.redoStack.slice(-60),
    };
  }
  restoreState(s) {
    this.doc = s.doc;
    this.doc.links = this.doc.links || [];
    this.view = s.view || { x: 0, y: 0, scale: 1 };
    this.selectedId = s.selectedId || (this.doc.root && this.doc.root.id);
    this.undoStack = s.undo || [];
    this.redoStack = s.redo || [];
    this.sizeCache.clear();
    this.render();
    this._applyTransform();
    this._emitSelect();
  }

  _theme() {
    return THEMES[this.doc.theme] || THEMES.blueprint;
  }

  // ---------- Undo / redo ----------
  _snapshot() {
    this.undoStack.push(JSON.stringify({ root: this.doc.root, links: this.doc.links }));
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify({ root: this.doc.root, links: this.doc.links }));
    const s = JSON.parse(this.undoStack.pop());
    this.doc.root = s.root;
    this.doc.links = s.links;
    this.sizeCache.clear();
    if (!this._findNode(this.selectedId)) this.selectedId = this.doc.root.id;
    this.render();
    this._emitChange();
    this._emitSelect();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify({ root: this.doc.root, links: this.doc.links }));
    const s = JSON.parse(this.redoStack.pop());
    this.doc.root = s.root;
    this.doc.links = s.links;
    this.sizeCache.clear();
    if (!this._findNode(this.selectedId)) this.selectedId = this.doc.root.id;
    this.render();
    this._emitChange();
    this._emitSelect();
  }

  // ---------- Tree helpers ----------
  _findNode(id, node = this.doc && this.doc.root, parent = null) {
    if (!node || !id) return null;
    if (node.id === id) return { node, parent };
    for (const c of node.children || []) {
      const r = this._findNode(id, c, node);
      if (r) return r;
    }
    return null;
  }
  getSelectedNode() {
    const f = this._findNode(this.selectedId);
    return f ? f.node : null;
  }
  _pathTo(id, node = this.doc.root, acc = []) {
    if (!node) return null;
    const a = [...acc, node];
    if (node.id === id) return a;
    for (const c of node.children || []) {
      const r = this._pathTo(id, c, a);
      if (r) return r;
    }
    return null;
  }

  // ---------- Editing operations ----------
  beginEdit() {
    this._snapshot();
  }
  liveText(id, text) {
    const f = this._findNode(id);
    if (!f) return;
    f.node.text = text;
    this.sizeCache.delete(id);
    this.render();
    this._emitChange();
  }
  livePatch(patch) {
    const f = this._findNode(this.selectedId);
    if (!f) return;
    Object.assign(f.node, patch);
    this.sizeCache.delete(f.node.id);
    this.render();
    this._emitChange();
  }
  applyToSelected(patch) {
    const f = this._findNode(this.selectedId);
    if (!f) return;
    this._snapshot();
    Object.assign(f.node, patch);
    this.sizeCache.delete(f.node.id);
    this.render();
    this._emitChange();
    this._emitSelect();
  }

  addChild(id = this.selectedId, edit = true) {
    const f = this._findNode(id);
    if (!f) return;
    this._snapshot();
    const n = newNode("");
    f.node.collapsed = false;
    f.node.children = f.node.children || [];
    f.node.children.push(n);
    this.selectedId = n.id;
    this.render();
    this._emitChange();
    this._emitSelect();
    this.ensureVisible(n.id);
    if (edit) this._beginEdit(n.id, true);
  }
  addSibling(id = this.selectedId, edit = true) {
    const f = this._findNode(id);
    if (!f) return;
    if (!f.parent) return this.addChild(id, edit);
    this._snapshot();
    const n = newNode("");
    const idx = f.parent.children.indexOf(f.node);
    f.parent.children.splice(idx + 1, 0, n);
    this.selectedId = n.id;
    this.render();
    this._emitChange();
    this._emitSelect();
    this.ensureVisible(n.id);
    if (edit) this._beginEdit(n.id, true);
  }
  removeSelected() {
    const f = this._findNode(this.selectedId);
    if (!f || !f.parent) return;
    this._snapshot();
    const ids = new Set();
    (function col(x) {
      ids.add(x.id);
      (x.children || []).forEach(col);
    })(f.node);
    this.doc.links = (this.doc.links || []).filter((l) => !ids.has(l.from) && !ids.has(l.to));
    const idx = f.parent.children.indexOf(f.node);
    f.parent.children.splice(idx, 1);
    this.selectedId = (f.parent.children[idx] || f.parent.children[idx - 1] || f.parent).id;
    this.render();
    this._emitChange();
    this._emitSelect();
  }
  toggleCollapse(id = this.selectedId) {
    const f = this._findNode(id);
    if (!f || !(f.node.children && f.node.children.length)) return;
    this._snapshot();
    f.node.collapsed = !f.node.collapsed;
    this.render();
    this._emitChange();
  }
  expandAll() {
    this._snapshot();
    (function w(n) {
      n.collapsed = false;
      (n.children || []).forEach(w);
    })(this.doc.root);
    this.render();
    this.fitToScreen();
    this._emitChange();
  }
  collapseAll() {
    this._snapshot();
    const root = this.doc.root;
    (function w(n) {
      if (n !== root && n.children && n.children.length) n.collapsed = true;
      (n.children || []).forEach(w);
    })(root);
    this.render();
    this.fitToScreen();
    this._emitChange();
  }

  setLayout(layout) {
    if (this.doc.layout === layout) return;
    this._snapshot();
    this.doc.layout = layout;
    this.render();
    this.fitToScreen();
    this._emitChange();
    this._emitStats();
  }
  setTheme(theme) {
    this.doc.theme = theme;
    this.render();
    this._emitChange();
  }

  select(id) {
    this.selectedId = id;
    this.render();
    this._emitSelect();
    if (id) this.svg.focus({ preventScroll: true });
  }

  // ---------- Cross-links ----------
  startLinkMode() {
    if (!this.selectedId) return;
    this.linkMode = true;
    this.host.classList.add("mv-linking");
  }
  _cancelLink() {
    this.linkMode = false;
    this.host.classList.remove("mv-linking");
  }
  _finishLink(targetId) {
    if (!this.selectedId || targetId === this.selectedId) {
      this._cancelLink();
      this.render();
      return;
    }
    this._snapshot();
    this.doc.links = this.doc.links || [];
    const exists = this.doc.links.some(
      (l) =>
        (l.from === this.selectedId && l.to === targetId) ||
        (l.from === targetId && l.to === this.selectedId)
    );
    if (!exists) this.doc.links.push({ from: this.selectedId, to: targetId, label: "" });
    this._cancelLink();
    this.render();
    this._emitChange();
    this._emitSelect();
  }
  removeLink(from, to) {
    this._snapshot();
    this.doc.links = (this.doc.links || []).filter((l) => !(l.from === from && l.to === to));
    this.render();
    this._emitChange();
    this._emitSelect();
  }
  setLinkLabel(from, to, label) {
    const link = (this.doc.links || []).find((l) => l.from === from && l.to === to);
    if (!link) return;
    this._snapshot();
    link.label = label;
    this.render();
    this._emitChange();
  }
  linksFor(id) {
    return (this.doc.links || []).filter((l) => l.from === id || l.to === id);
  }

  // ---------- Search & replace ----------
  findMatches(q, caseSensitive = false) {
    if (!q) return [];
    const res = [];
    const needle = caseSensitive ? q : q.toLowerCase();
    (function w(n) {
      const t = caseSensitive ? n.text || "" : (n.text || "").toLowerCase();
      if (t.includes(needle)) res.push(n.id);
      (n.children || []).forEach(w);
    })(this.doc.root);
    return res;
  }
  focusMatch(id) {
    const path = this._pathTo(id);
    if (path) for (const n of path) if (n.id !== id) n.collapsed = false;
    this.selectedId = id;
    this.render();
    this._emitSelect();
    this._centerNode(id);
  }
  replaceAll(q, repl, caseSensitive = false) {
    if (!q) return 0;
    let count = 0;
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
    this._snapshot();
    (function w(n) {
      if (n.text) {
        rx.lastIndex = 0;
        if (rx.test(n.text)) {
          n.text = n.text.replace(rx, repl);
          count++;
        }
      }
      (n.children || []).forEach(w);
    })(this.doc.root);
    if (count) {
      this.sizeCache.clear();
      this.render();
      this._emitChange();
      this._emitSelect();
    } else {
      this.undoStack.pop();
    }
    return count;
  }

  // ---------- Measure & size ----------
  _measure(str) {
    this.measurer.textContent = str || "";
    return this.measurer.getComputedTextLength();
  }
  _wrap(text) {
    const out = [];
    for (const para of (text || "").split("\n")) {
      if (para === "") {
        out.push("");
        continue;
      }
      const words = para.split(/(\s+)/);
      let line = "";
      for (const w of words) {
        const test = line + w;
        if (this._measure(test.trim()) > MAXW && line.trim()) {
          out.push(line.trim());
          line = w.replace(/^\s+/, "");
        } else {
          line = test;
        }
      }
      out.push(line.trim());
    }
    return out.length ? out : [""];
  }
  _size(n) {
    const key = `${n.text}|${n.icon}|${n.progress}|${n.note ? 1 : 0}|${n.link ? 1 : 0}`;
    const cached = this.sizeCache.get(n.id);
    if (cached && cached.key === key) return cached;
    const lines = this._wrap(n.text || "");
    let textW = 0;
    for (const l of lines) textW = Math.max(textW, this._measure(l || " "));
    textW = Math.max(textW, 14);
    const hasIcon = !!(n.icon && ICON_BY_ID[n.icon]);
    const badges = (n.note ? 1 : 0) + (n.link ? 1 : 0);
    const badgeW = badges ? badges * 16 + 4 : 0;
    let w = PAD * 2 + textW + (hasIcon ? ICONW : 0) + badgeW;
    w = Math.max(w, hasIcon ? 64 : 46);
    let h = PAD * 2 + lines.length * LH;
    if (n.progress != null) h += 9;
    const size = { w: Math.round(w), h: Math.round(h), lines, hasIcon, key };
    this.sizeCache.set(n.id, size);
    return size;
  }

  // ---------- Render ----------
  render() {
    if (!this.doc) return;
    const theme = this._theme();
    this.host.style.background = theme.canvas;
    this._hideNote();
    this.lastPos = computeLayout(this.doc, (n) => this._size(n));
    this.gEdges.textContent = "";
    this.gLinks.textContent = "";
    this.gNodes.textContent = "";
    this._renderEdges(theme);
    this._renderCrossLinks(theme);
    this._renderNodes(theme);
    this._emitStats();
  }

  _visibleEdges() {
    const edges = [];
    const walk = (n) => {
      if (n.collapsed) return;
      for (const c of n.children || []) {
        edges.push([n, c]);
        walk(c);
      }
    };
    walk(this.doc.root);
    return edges;
  }

  _connector(pp, cp) {
    const lay = this.doc.layout;
    if (lay === "tree") {
      const a = { x: pp.x, y: pp.y + pp.h / 2 };
      const b = { x: cp.x, y: cp.y - cp.h / 2 };
      const my = (a.y + b.y) / 2;
      return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
    }
    if (lay === "org") {
      const a = { x: pp.x, y: pp.y + pp.h / 2 };
      const b = { x: cp.x, y: cp.y - cp.h / 2 };
      const my = (a.y + b.y) / 2;
      return `M${a.x},${a.y} L${a.x},${my} L${b.x},${my} L${b.x},${b.y}`;
    }
    if (lay === "logic") {
      const a = { x: pp.x + pp.w / 2, y: pp.y };
      const b = { x: cp.x - cp.w / 2, y: cp.y };
      const mx = (a.x + b.x) / 2;
      return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    }
    if (cp.side === "left") {
      const a = { x: pp.x - pp.w / 2, y: pp.y };
      const b = { x: cp.x + cp.w / 2, y: cp.y };
      const mx = (a.x + b.x) / 2;
      return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    }
    const a = { x: pp.x + pp.w / 2, y: pp.y };
    const b = { x: cp.x - cp.w / 2, y: cp.y };
    const mx = (a.x + b.x) / 2;
    return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
  }

  _renderEdges(theme) {
    for (const [parent, child] of this._visibleEdges()) {
      const pp = this.lastPos.get(parent.id);
      const cp = this.lastPos.get(child.id);
      if (!pp || !cp) continue;
      const width = Math.max(1.1, 2.4 - (cp.depth - 1) * 0.3);
      this.gEdges.appendChild(
        el("path", {
          d: this._connector(pp, cp),
          fill: "none",
          stroke: theme.edge,
          "stroke-width": width,
          "stroke-linecap": "round",
        })
      );
    }
  }

  _renderCrossLinks(theme) {
    const edgePoint = (b, tx, ty) => {
      const dx = tx - b.x;
      const dy = ty - b.y;
      if (!dx && !dy) return { x: b.x, y: b.y };
      const sx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx);
      const sy = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy);
      const s = Math.min(sx, sy);
      return { x: b.x + dx * s, y: b.y + dy * s };
    };
    for (const link of this.doc.links || []) {
      const fb = this.lastPos.get(link.from);
      const tb = this.lastPos.get(link.to);
      if (!fb || !tb) continue;
      const a = edgePoint(fb, tb.x, tb.y);
      const b = edgePoint(tb, fb.x, fb.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const len = Math.hypot(nx, ny) || 1;
      const off = Math.min(40, len * 0.16);
      const cx = mx + (nx / len) * off;
      const cy = my + (ny / len) * off;
      const g = el("g", { class: "mv-xlink", style: "cursor:pointer" });
      g.appendChild(
        el("path", {
          d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`,
          fill: "none",
          stroke: theme.link,
          "stroke-width": 1.6,
          "stroke-dasharray": "5 4",
        })
      );
      const ang = Math.atan2(b.y - cy, b.x - cx);
      const ah = 6;
      g.appendChild(
        el("path", {
          d: `M${b.x},${b.y} L${b.x - ah * Math.cos(ang - 0.4)},${
            b.y - ah * Math.sin(ang - 0.4)
          } L${b.x - ah * Math.cos(ang + 0.4)},${b.y - ah * Math.sin(ang + 0.4)} Z`,
          fill: theme.link,
        })
      );
      if (link.label) {
        const tw = this._measure(link.label) + 12;
        g.appendChild(
          el("rect", {
            x: cx - tw / 2,
            y: cy - 9,
            width: tw,
            height: 16,
            rx: 8,
            fill: theme.canvas,
            stroke: theme.link,
            "stroke-width": 1,
          })
        );
        g.appendChild(
          el(
            "text",
            {
              x: cx,
              y: cy,
              "font-size": 10.5,
              fill: theme.link,
              "text-anchor": "middle",
              "dominant-baseline": "central",
              "font-family": FONT,
            },
            link.label
          )
        );
      }
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        this.select(link.from);
      });
      this.gLinks.appendChild(g);
    }
  }

  _renderNodes(theme) {
    const rootId = this.doc.root.id;
    for (const [id, p] of this.lastPos) {
      const f = this._findNode(id);
      if (!f) continue;
      const n = f.node;
      const isRoot = id === rootId;
      const fill = isRoot ? theme.root : n.color || theme.node;
      const stroke = isRoot ? theme.root : theme.nodeStroke;
      const textColor = isRoot ? theme.rootText : theme.text;
      const size = this._size(n);
      const g = el("g", {
        class: "mv-node",
        "data-id": id,
        transform: `translate(${p.x - p.w / 2},${p.y - p.h / 2})`,
      });

      g.appendChild(
        el("rect", {
          class: "mv-box",
          x: 0,
          y: 0,
          width: p.w,
          height: p.h,
          rx: 9,
          ry: 9,
          fill,
          stroke,
          "stroke-width": isRoot ? 0 : 1.5,
        })
      );
      if (this.selectedId === id) {
        g.appendChild(
          el("rect", {
            class: "mv-sel ui-only",
            x: -3,
            y: -3,
            width: p.w + 6,
            height: p.h + 6,
            rx: 11,
            ry: 11,
            fill: "none",
            stroke: theme.accent,
            "stroke-width": 2,
          })
        );
      }

      let textX = PAD;
      if (size.hasIcon) {
        g.appendChild(
          el(
            "text",
            {
              x: PAD,
              y: p.h / 2,
              "font-size": 15,
              "dominant-baseline": "central",
              "text-anchor": "start",
            },
            ICON_BY_ID[n.icon]
          )
        );
        textX = PAD + ICONW;
      }

      const blockH = size.lines.length * LH;
      const topPad = (p.h - (n.progress != null ? 9 : 0) - blockH) / 2;
      const txt = el("text", {
        class: "mv-tx",
        x: textX,
        y: 0,
        "font-size": FS,
        "font-family": FONT,
        fill: textColor,
      });
      size.lines.forEach((ln, i) => {
        txt.appendChild(el("tspan", { x: textX, y: topPad + i * LH + LH * 0.75 }, ln || " "));
      });
      g.appendChild(txt);

      if (n.progress != null) {
        const bw = p.w - 2 * PAD;
        const by = p.h - 8;
        const pct = Math.min(100, Math.max(0, n.progress));
        g.appendChild(
          el("rect", {
            x: PAD,
            y: by,
            width: bw,
            height: 5,
            rx: 2.5,
            fill: isRoot ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.10)",
          })
        );
        g.appendChild(
          el("rect", {
            x: PAD,
            y: by,
            width: (bw * pct) / 100,
            height: 5,
            rx: 2.5,
            fill: theme.accent,
          })
        );
      }

      let bx = p.w - 12;
      if (n.link) {
        const a = el(
          "text",
          { class: "mv-badge ui-link", x: bx, y: 13, "font-size": 11, "text-anchor": "middle", style: "cursor:pointer" },
          "🔗"
        );
        a.addEventListener("click", (e) => {
          e.stopPropagation();
          window.open(n.link, "_blank", "noopener");
        });
        g.appendChild(a);
        bx -= 16;
      }
      if (n.note) {
        const t = el(
          "text",
          {
            class: "mv-badge ui-note",
            x: bx,
            y: 13,
            "font-size": 11,
            "text-anchor": "middle",
            style: "cursor:pointer",
          },
          "📝"
        );
        t.appendChild(el("title", {}, n.note.length > 140 ? n.note.slice(0, 140) + "…" : n.note));
        t.addEventListener("pointerdown", (e) => e.stopPropagation());
        t.addEventListener("click", (e) => {
          e.stopPropagation();
          this._showNote(n, t);
        });
        g.appendChild(t);
        bx -= 16;
      }

      if (n.children && n.children.length) {
        const lay = this.doc.layout;
        let cx, cy;
        if (lay === "tree" || lay === "org") {
          cx = p.w / 2;
          cy = p.h;
        } else if (lay === "logic") {
          cx = p.w;
          cy = p.h / 2;
        } else {
          cx = p.side === "left" ? 0 : p.w;
          cy = p.h / 2;
        }
        const tg = el("g", { class: "mv-toggle ui-only", style: "cursor:pointer" });
        tg.appendChild(
          el("circle", { cx, cy, r: 7, fill: theme.node, stroke: theme.nodeStroke, "stroke-width": 1.3 })
        );
        tg.appendChild(
          el("line", { x1: cx - 3.2, y1: cy, x2: cx + 3.2, y2: cy, stroke: theme.text, "stroke-width": 1.4 })
        );
        if (n.collapsed)
          tg.appendChild(
            el("line", { x1: cx, y1: cy - 3.2, x2: cx, y2: cy + 3.2, stroke: theme.text, "stroke-width": 1.4 })
          );
        tg.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleCollapse(id);
        });
        g.appendChild(tg);
      }

      g.addEventListener("pointerdown", (e) => e.stopPropagation());
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.linkMode) this._finishLink(id);
        else this.select(id);
      });
      g.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._beginEdit(id, true);
      });
      this.gNodes.appendChild(g);
    }
  }

  // ---------- View transform ----------
  _applyTransform() {
    this.viewport.setAttribute(
      "transform",
      `translate(${this.view.x},${this.view.y}) scale(${this.view.scale})`
    );
    if (this.opts.onView) this.opts.onView(this.view);
    this._emitStats();
  }
  _zoomAround(sx, sy, f) {
    const old = this.view.scale;
    const ns = Math.max(0.15, Math.min(3, old * f));
    const k = ns / old;
    this.view.x = sx - (sx - this.view.x) * k;
    this.view.y = sy - (sy - this.view.y) * k;
    this.view.scale = ns;
    this._applyTransform();
  }
  zoomBy(f) {
    const r = this.svg.getBoundingClientRect();
    this._zoomAround(r.width / 2, r.height / 2, f);
  }
  setZoom(scale) {
    const r = this.svg.getBoundingClientRect();
    this._zoomAround(r.width / 2, r.height / 2, scale / this.view.scale);
  }
  _contentBBox() {
    if (!this.lastPos || !this.lastPos.size) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [, p] of this.lastPos) {
      minX = Math.min(minX, p.x - p.w / 2);
      minY = Math.min(minY, p.y - p.h / 2);
      maxX = Math.max(maxX, p.x + p.w / 2);
      maxY = Math.max(maxY, p.y + p.h / 2);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  fitToScreen(padding = 60) {
    const b = this._contentBBox();
    if (!b) return;
    const r = this.svg.getBoundingClientRect();
    const sw = r.width || 900;
    const sh = r.height || 600;
    const scale = Math.min((sw - 2 * padding) / b.w, (sh - 2 * padding) / b.h, 1.6);
    this.view.scale = Math.max(0.15, Math.min(scale, 1.6));
    this.view.x = sw / 2 - (b.x + b.w / 2) * this.view.scale;
    this.view.y = sh / 2 - (b.y + b.h / 2) * this.view.scale;
    this._applyTransform();
  }
  _toScreen(mx, my) {
    return { x: mx * this.view.scale + this.view.x, y: my * this.view.scale + this.view.y };
  }
  _centerNode(id) {
    const p = this.lastPos.get(id);
    if (!p) return;
    const r = this.svg.getBoundingClientRect();
    this.view.x = r.width / 2 - p.x * this.view.scale;
    this.view.y = r.height / 2 - p.y * this.view.scale;
    this._applyTransform();
  }
  ensureVisible(id) {
    const p = this.lastPos.get(id);
    if (!p) return;
    const s = this._toScreen(p.x, p.y);
    const r = this.svg.getBoundingClientRect();
    const m = 48;
    if (s.x < m || s.x > r.width - m || s.y < m || s.y > r.height - m) this._centerNode(id);
  }

  // ---------- Note popover (rendered markdown) ----------
  _showNote(node, badgeEl) {
    const r = badgeEl.getBoundingClientRect();
    const hostR = this.host.getBoundingClientRect();
    this.notePop.innerHTML =
      '<div class="mv-notepop-head"><span class="npt">Note</span>' +
      '<button type="button" aria-label="Close">×</button></div>' +
      '<div class="markdown-body">' +
      renderMarkdown(node.note) +
      "</div>";
    this.notePop.querySelector("button").addEventListener("click", (e) => {
      e.stopPropagation();
      this._hideNote();
    });
    this.notePop.hidden = false;
    const popW = this.notePop.offsetWidth;
    const popH = this.notePop.offsetHeight;
    let left = r.left - hostR.left + r.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, hostR.width - popW - 8));
    let top = r.bottom - hostR.top + 8;
    if (top + popH > hostR.height - 8) top = Math.max(8, r.top - hostR.top - popH - 8);
    this.notePop.style.left = left + "px";
    this.notePop.style.top = top + "px";
  }
  _hideNote() {
    if (this.notePop) this.notePop.hidden = true;
  }

  // ---------- Inline editor ----------
  _beginEdit(id, selectAll = false) {
    const f = this._findNode(id);
    if (!f) return;
    this.selectedId = id;
    this.render();
    this._emitSelect();
    this.beginEdit();
    this._editId = id;
    this._editPrev = f.node.text;
    this._editing = true;
    const p = this.lastPos.get(id);
    this._positionEditor(p);
    this.editor.value = f.node.text;
    this.editor.style.display = "block";
    this.editor.focus();
    if (selectAll) this.editor.select();
  }
  _positionEditor(p) {
    const s = this._toScreen(p.x, p.y);
    const w = Math.max(90, p.w * this.view.scale);
    const h = Math.max(28, p.h * this.view.scale);
    this.editor.style.left = s.x - w / 2 + "px";
    this.editor.style.top = s.y - h / 2 + "px";
    this.editor.style.width = w + "px";
    this.editor.style.height = h + "px";
    this.editor.style.fontSize = FS * this.view.scale + "px";
  }
  _endEdit(commit = true) {
    if (!this._editing) return;
    this._editing = false;
    this.editor.style.display = "none";
    const id = this._editId;
    this._editId = null;
    if (!commit) {
      const f = this._findNode(id);
      if (f) {
        f.node.text = this._editPrev;
        this.sizeCache.delete(id);
        this.render();
      }
      if (this.undoStack.length) this.undoStack.pop();
    } else {
      this._emitChange();
    }
  }

  // ---------- Keyboard ----------
  _onKey(e) {
    if (this._editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod) return; // let app handle Ctrl+S/F etc.
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        this.addSibling();
        break;
      case "Tab":
        e.preventDefault();
        this.addChild();
        break;
      case "F2":
        e.preventDefault();
        if (this.selectedId) this._beginEdit(this.selectedId, true);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        this.removeSelected();
        break;
      case " ":
        e.preventDefault();
        this.toggleCollapse();
        break;
      case "ArrowUp":
        e.preventDefault();
        this._navigate("up");
        break;
      case "ArrowDown":
        e.preventDefault();
        this._navigate("down");
        break;
      case "ArrowLeft":
        e.preventDefault();
        this._navigate("left");
        break;
      case "ArrowRight":
        e.preventDefault();
        this._navigate("right");
        break;
      case "+":
      case "=":
        e.preventDefault();
        this.zoomBy(1.12);
        break;
      case "-":
        e.preventDefault();
        this.zoomBy(0.89);
        break;
      case "0":
        e.preventDefault();
        this.fitToScreen();
        break;
      case "Escape":
        this._hideNote();
        if (this.linkMode) this._cancelLink();
        break;
    }
  }
  _navigate(dir) {
    const cur = this.lastPos.get(this.selectedId);
    if (!cur) {
      this.select(this.doc.root.id);
      return;
    }
    let best = null,
      bestScore = Infinity;
    for (const [id, p] of this.lastPos) {
      if (id === this.selectedId) continue;
      const dx = p.x - cur.x;
      const dy = p.y - cur.y;
      let primary, secondary;
      if (dir === "left") {
        if (dx >= -2) continue;
        primary = -dx;
        secondary = Math.abs(dy);
      } else if (dir === "right") {
        if (dx <= 2) continue;
        primary = dx;
        secondary = Math.abs(dy);
      } else if (dir === "up") {
        if (dy >= -2) continue;
        primary = -dy;
        secondary = Math.abs(dx);
      } else {
        if (dy <= 2) continue;
        primary = dy;
        secondary = Math.abs(dx);
      }
      const score = primary + secondary * 2;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best) {
      this.selectedId = best;
      this.render();
      this._emitSelect();
      this.ensureVisible(best);
    }
  }

  // ---------- Export ----------
  getExportSVG(margin = 40) {
    const theme = this._theme();
    const b = this._contentBBox();
    if (!b) return null;
    const clone = this.viewport.cloneNode(true);
    clone.removeAttribute("transform");
    clone.querySelectorAll(".ui-only").forEach((e) => e.remove());
    const W = Math.ceil(b.w + margin * 2);
    const H = Math.ceil(b.h + margin * 2);
    const svg = el("svg", {
      xmlns: SVGNS,
      "xmlns:xlink": "http://www.w3.org/1999/xlink",
      width: W,
      height: H,
      viewBox: `${b.x - margin} ${b.y - margin} ${W} ${H}`,
      "font-family": FONT,
    });
    svg.appendChild(
      el("rect", { x: b.x - margin, y: b.y - margin, width: W, height: H, fill: theme.canvas })
    );
    svg.appendChild(clone);
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    return { svg: str, width: W, height: H, background: theme.canvas };
  }

  // ---------- Emit ----------
  _emitChange() {
    if (this.opts.onChange) this.opts.onChange();
  }
  _emitSelect() {
    if (this.opts.onSelect) this.opts.onSelect(this.getSelectedNode(), this);
  }
  _emitStats() {
    if (!this.opts.onStats) return;
    let n = 0;
    (function c(x) {
      n++;
      (x.children || []).forEach(c);
    })(this.doc.root);
    this.opts.onStats({ nodes: n, zoom: this.view.scale, layout: this.doc.layout });
  }
}
