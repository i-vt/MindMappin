import { MapView } from "./mapview.js";
import { THEMES } from "./themes.js";
import { ICONS } from "./icons.js";
import { NODE_COLORS } from "./themes.js";
import {
  uid,
  newNode,
  toText,
  toCSV,
  toFreeMind,
  fromFreeMind,
  fromJSON,
  downloadText,
  exportRaster,
} from "./format.js";
import { renderMarkdown } from "./markdown.js";

const $ = (id) => document.getElementById(id);
const LAYOUT_NAMES = { mindmap: "Mind map", tree: "Tree", org: "Org chart", logic: "Logic" };
let mode = document.documentElement.dataset.mode === "light" ? "light" : "dark";
const modeDefaultTheme = (m) => (m === "dark" ? "slate" : "blueprint");
let lastTheme = modeDefaultTheme(mode);
let noteTab = "write";

const view = new MapView($("canvas"), {
  onChange: () => {
    if (active >= 0) {
      tabs[active].dirty = true;
      paintTabDirty();
    }
    scheduleSave();
  },
  onSelect: (node) => refreshInspector(node),
  onStats: (s) => {
    $("stat-nodes").textContent = `${s.nodes} ${s.nodes === 1 ? "topic" : "topics"}`;
    $("stat-layout").textContent = LAYOUT_NAMES[s.layout] || s.layout;
    const z = Math.round(s.zoom * 100) + "%";
    $("stat-zoom").textContent = z;
    $("zoom-label").textContent = z;
    setActiveLayout(s.layout);
  },
});

/* ---------------- Tabs ---------------- */
let tabs = [];
let active = -1;

function sampleDoc() {
  const root = newNode("My Project");
  const plan = newNode("Plan");
  plan.icon = "calendar";
  const a = newNode("Define scope");
  a.progress = 100;
  a.icon = "check";
  const b = newNode("Draft timeline");
  b.progress = 40;
  plan.children = [a, b];

  const build = newNode("Build");
  build.icon = "rocket";
  const f1 = newNode("Core features");
  const f2 = newNode("Polish UI");
  f2.color = "#CBE6F2";
  build.children = [f1, f2];

  const risks = newNode("Risks");
  risks.icon = "warn";
  risks.note =
    "### Watch list\n\nTrack anything that could **slip the launch date**.\n\n- [ ] Vendor sign-off\n- [x] Security review\n\nSee the [release plan](https://example.com) for details.";
  const r1 = newNode("Scope creep");
  risks.children = [r1];

  root.children = [plan, build, risks];
  return {
    id: uid(),
    title: "Welcome map",
    layout: "mindmap",
    theme: lastTheme,
    root,
    links: [{ from: b.id, to: f1.id, label: "feeds" }],
  };
}

function makeDoc() {
  const root = newNode("Central idea");
  return { id: uid(), title: "Untitled map", layout: "mindmap", theme: lastTheme, root, links: [] };
}

function addTab(doc, { activate = true } = {}) {
  if (!doc.id) doc.id = uid();
  doc.links = doc.links || [];
  tabs.push({
    tabId: uid(),
    dirty: false,
    state: { doc, view: null, selectedId: doc.root.id, undo: [], redo: [] },
  });
  if (activate) switchTo(tabs.length - 1);
  else renderTabs();
}

function switchTo(i) {
  if (i < 0 || i >= tabs.length) return;
  if (active >= 0 && tabs[active]) tabs[active].state = view.serializeState();
  active = i;
  const st = tabs[i].state;
  lastTheme = st.doc.theme || lastTheme;
  if (!st.view) view.setDocument(st.doc);
  else view.restoreState(st);
  renderTabs();
  syncToolbar();
  refreshInspector(view.getSelectedNode());
  scheduleSave();
}

function closeTab(i) {
  tabs.splice(i, 1);
  if (!tabs.length) {
    active = -1;
    addTab(makeDoc());
    return;
  }
  if (i < active) active--;
  else if (i === active) active = -1;
  switchTo(Math.min(active < 0 ? i : active, tabs.length - 1));
}

function renderTabs() {
  const nav = $("tabs");
  nav.innerHTML = "";
  tabs.forEach((t, i) => {
    const el = document.createElement("div");
    el.className = "tab" + (i === active ? " active" : "") + (t.dirty ? " dirty" : "");
    const name = document.createElement("span");
    name.className = "tname";
    name.textContent = t.state.doc.title || "Untitled";
    name.addEventListener("click", () => switchTo(i));
    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startRename(el, name, t);
    });
    const close = document.createElement("button");
    close.className = "tclose";
    close.textContent = "×";
    close.title = "Close map";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(i);
    });
    el.append(name, close);
    nav.appendChild(el);
  });
}
function paintTabDirty() {
  const nav = $("tabs").children;
  tabs.forEach((t, i) => {
    if (nav[i]) nav[i].classList.toggle("dirty", !!t.dirty);
  });
}
function startRename(tabEl, nameEl, tab) {
  const input = document.createElement("input");
  input.className = "tedit";
  input.value = tab.state.doc.title || "";
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    tab.state.doc.title = input.value.trim() || "Untitled map";
    tab.dirty = true;
    renderTabs();
    scheduleSave();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") renderTabs();
  });
  input.addEventListener("blur", commit);
}

/* ---------------- Toolbar ---------------- */
function setActiveLayout(layout) {
  $("layout-seg")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.layout === layout));
}
function syncToolbar() {
  if (!view.doc) return;
  setActiveLayout(view.doc.layout);
  $("theme-select").value = view.doc.theme;
}
function populateThemes() {
  const sel = $("theme-select");
  for (const key in THEMES) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = THEMES[key].name;
    sel.appendChild(o);
  }
}

function safeName() {
  return (view.doc.title || "mindmap").replace(/[^\w.-]+/g, "_").slice(0, 60) || "mindmap";
}

async function doExport(fmt) {
  closeMenus();
  const raster = ["png", "jpeg", "gif", "bmp", "tiff", "pdf"];
  if (raster.includes(fmt)) {
    const ex = view.getExportSVG();
    if (!ex) return toast("Nothing to export yet.");
    toast("Rendering " + fmt.toUpperCase() + "…");
    try {
      await exportRaster(ex.svg, fmt, 2, ex.background);
    } catch (e) {
      toast(e.message || "Export failed.");
    }
    return;
  }
  if (fmt === "svg") {
    const ex = view.getExportSVG();
    if (!ex) return toast("Nothing to export yet.");
    return downloadText(ex.svg, safeName() + ".svg", "image/svg+xml");
  }
  if (fmt === "txt") return downloadText(toText(view.doc), safeName() + ".txt");
  if (fmt === "csv") return downloadText(toCSV(view.doc), safeName() + ".csv", "text/csv");
  if (fmt === "mm")
    return downloadText(toFreeMind(view.doc), safeName() + ".mm", "application/xml");
  if (fmt === "json")
    return downloadText(JSON.stringify(view.doc, null, 2), safeName() + ".json", "application/json");
}

async function saveDoc() {
  if (active < 0) return;
  tabs[active].state = view.serializeState();
  const doc = view.doc;
  try {
    const res = await fetch("/api/docs/" + encodeURIComponent(doc.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed.");
    tabs[active].dirty = false;
    renderTabs();
    toast("Saved “" + doc.title + "”");
  } catch (e) {
    toast(e.message);
  }
}

async function openDialog() {
  const dlg = $("open-dialog");
  const list = $("open-list");
  dlg.showModal();
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const docs = await (await fetch("/api/docs")).json();
    if (!docs.length) {
      list.innerHTML = '<p class="muted">No saved maps yet. Use Save to store one here.</p>';
      return;
    }
    list.innerHTML = "";
    for (const d of docs) {
      const item = document.createElement("div");
      item.className = "open-item";
      const main = document.createElement("div");
      main.className = "oi-main";
      main.innerHTML = `<div class="oi-title"></div><div class="oi-meta">${
        LAYOUT_NAMES[d.layout] || d.layout
      } · ${new Date(d.updatedAt).toLocaleString()}</div>`;
      main.querySelector(".oi-title").textContent = d.title;
      const open = document.createElement("button");
      open.className = "tbtn";
      open.type = "button";
      open.textContent = "Open";
      open.addEventListener("click", async () => {
        try {
          const doc = fromJSON(await (await fetch("/api/docs/" + encodeURIComponent(d.id))).text());
          doc.id = d.id;
          dlg.close();
          addTab(doc);
        } catch (e) {
          toast(e.message || "Could not open map.");
        }
      });
      const del = document.createElement("button");
      del.className = "tbtn danger";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        await fetch("/api/docs/" + encodeURIComponent(d.id), { method: "DELETE" });
        toast("Deleted “" + d.title + "”");
        openDialog();
      });
      item.append(main, open, del);
      list.appendChild(item);
    }
  } catch {
    list.innerHTML = '<p class="muted">Could not load saved maps.</p>';
  }
}

function importFile() {
  $("file-input").click();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function applyMode(m, { switchCanvas = false } = {}) {
  const prev = mode;
  mode = m;
  document.documentElement.dataset.mode = m;
  try {
    localStorage.setItem("blumind.mode", m);
  } catch {}
  const btn = $("btn-mode");
  if (btn) {
    btn.textContent = m === "dark" ? "☀" : "☾";
    btn.title = m === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
  // Keep the canvas palette in step with the mode: maps still using the other
  // mode's default theme follow along; deliberately-chosen palettes are left.
  if (switchCanvas && prev !== m) {
    const from = modeDefaultTheme(prev);
    const to = modeDefaultTheme(m);
    let changedActive = false;
    for (const t of tabs) {
      if (t.state.doc && t.state.doc.theme === from) {
        t.state.doc.theme = to;
        if (t === tabs[active]) changedActive = true;
      }
    }
    if (lastTheme === from) lastTheme = to;
    if (changedActive && view.doc) view.setTheme(view.doc.theme);
    syncToolbar();
    scheduleSave();
  }
}
function toggleMode() {
  applyMode(mode === "dark" ? "light" : "dark", { switchCanvas: true });
}

function printMap() {
  const ex = view.getExportSVG(28);
  if (!ex) return toast("Nothing to print.");
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print.");
  w.document.write(
    `<!doctype html><title>${escapeHtml(view.doc.title)}</title>` +
      `<style>html,body{margin:0;background:#fff}svg{max-width:100%;height:auto;display:block;margin:auto}</style>` +
      ex.svg
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function closeMenus() {
  $("export-menu").hidden = true;
}

function bindToolbar() {
  $("tab-add").addEventListener("click", () => addTab(makeDoc()));
  $("btn-open").addEventListener("click", openDialog);
  $("btn-save").addEventListener("click", saveDoc);
  $("btn-import").addEventListener("click", importFile);

  const exportBtn = $("btn-export");
  const exportMenu = $("export-menu");
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (exportMenu.hidden) {
      const r = exportBtn.getBoundingClientRect();
      exportMenu.style.top = r.bottom + 6 + "px";
      exportMenu.style.left = "auto";
      exportMenu.style.right = window.innerWidth - r.right + "px";
      exportMenu.hidden = false;
    } else {
      exportMenu.hidden = true;
    }
  });
  exportMenu
    .querySelectorAll("button[data-fmt]")
    .forEach((b) => b.addEventListener("click", () => doExport(b.dataset.fmt)));
  document.addEventListener("click", closeMenus);

  $("layout-seg")
    .querySelectorAll("button")
    .forEach((b) => b.addEventListener("click", () => view.setLayout(b.dataset.layout)));
  $("theme-select").addEventListener("change", (e) => {
    lastTheme = e.target.value;
    view.setTheme(e.target.value);
    tabs[active] && (tabs[active].dirty = true);
    renderTabs();
  });

  $("btn-fit").addEventListener("click", () => view.fitToScreen());
  $("btn-expand").addEventListener("click", () => view.expandAll());
  $("btn-collapse").addEventListener("click", () => view.collapseAll());
  $("btn-zoom-in").addEventListener("click", () => view.zoomBy(1.15));
  $("btn-zoom-out").addEventListener("click", () => view.zoomBy(0.87));
  $("btn-print").addEventListener("click", printMap);
  $("btn-full").addEventListener("click", toggleFullscreen);
  $("btn-search").addEventListener("click", openSearch);

  const mb = $("btn-mode");
  mb.textContent = mode === "dark" ? "☀" : "☾";
  mb.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
  mb.addEventListener("click", toggleMode);

  $("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      let doc;
      if (file.name.toLowerCase().endsWith(".mm")) {
        doc = {
          id: uid(),
          title: file.name.replace(/\.mm$/i, ""),
          layout: "mindmap",
          theme: lastTheme,
          root: fromFreeMind(text),
          links: [],
        };
      } else {
        doc = fromJSON(text);
        doc.id = uid();
      }
      addTab(doc);
      toast("Imported “" + doc.title + "”");
    } catch (err) {
      toast(err.message || "Could not import that file.");
    }
    e.target.value = "";
  });

  $("open-dialog")
    .querySelector(".icon-btn")
    .addEventListener("click", () => $("open-dialog").close());
}

/* ---------------- Search & replace ---------------- */
let matches = [];
let mi = -1;

function openSearch() {
  $("searchbar").hidden = false;
  $("find-input").focus();
  $("find-input").select();
}
function closeSearch() {
  $("searchbar").hidden = true;
  matches = [];
  mi = -1;
}
function updateCount() {
  const el = $("find-count");
  if (!matches.length) el.textContent = "0 matches";
  else el.textContent = `${mi + 1} of ${matches.length}`;
}
function runFind() {
  const q = $("find-input").value.trim();
  matches = view.findMatches(q, $("find-case").checked);
  mi = matches.length ? 0 : -1;
  updateCount();
  if (mi >= 0) view.focusMatch(matches[mi]);
}
function step(d) {
  if (!matches.length) return;
  mi = (mi + d + matches.length) % matches.length;
  view.focusMatch(matches[mi]);
  updateCount();
}
function bindSearch() {
  let t;
  $("find-input").addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(runFind, 160);
  });
  $("find-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.shiftKey ? step(-1) : step(1);
    }
  });
  $("find-case").addEventListener("change", runFind);
  $("find-next").addEventListener("click", () => step(1));
  $("find-prev").addEventListener("click", () => step(-1));
  $("find-close").addEventListener("click", closeSearch);
  $("replace-all").addEventListener("click", () => {
    const n = view.replaceAll($("find-input").value, $("replace-input").value, $("find-case").checked);
    toast(n ? `Replaced ${n} ${n === 1 ? "topic" : "topics"}` : "No matches to replace.");
    runFind();
  });
}

/* ---------------- Inspector ---------------- */
function initInspector() {
  // icon grid
  const ig = $("insp-icons");
  ICONS.forEach((ic) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.icon = ic.id;
    b.title = ic.label;
    if (ic.id === "") {
      b.className = "none";
      b.textContent = "—";
    } else b.textContent = ic.glyph;
    b.addEventListener("click", () => view.applyToSelected({ icon: ic.id }));
    ig.appendChild(b);
  });
  // color swatches
  const cg = $("insp-colors");
  NODE_COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.color = c;
    if (c === "") b.className = "none";
    else b.style.background = c;
    b.title = c || "Default";
    b.addEventListener("click", () => view.applyToSelected({ color: c }));
    cg.appendChild(b);
  });

  // text / note / link: snapshot on focus, live update on input
  for (const [id, key] of [
    ["insp-text", "text"],
    ["insp-note", "note"],
    ["insp-link", "link"],
  ]) {
    const elx = $(id);
    elx.addEventListener("focus", () => view.beginEdit());
    elx.addEventListener("input", () => view.livePatch({ [key]: elx.value }));
  }

  // note: Write / Preview tabs
  document.querySelectorAll("[data-note-tab]").forEach((b) =>
    b.addEventListener("click", () => setNoteTab(b.dataset.noteTab))
  );

  // progress
  $("insp-prog-on").addEventListener("change", (e) => {
    view.applyToSelected({ progress: e.target.checked ? Number($("insp-prog").value) || 0 : null });
  });
  $("insp-prog").addEventListener("pointerdown", () => view.beginEdit());
  $("insp-prog").addEventListener("input", (e) => {
    $("insp-prog-val").textContent = e.target.value + "%";
    view.livePatch({ progress: Number(e.target.value) });
  });

  // actions
  $("insp-body").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "child") view.addChild();
    else if (act === "sibling") view.addSibling();
    else if (act === "delete") view.removeSelected();
    else if (act === "fold") view.toggleCollapse();
  });
  $("btn-connect").addEventListener("click", () => {
    view.startLinkMode();
    toast("Click another topic to connect.");
  });
}

function setNoteTab(tab) {
  noteTab = tab;
  const ta = $("insp-note");
  const pv = $("insp-note-preview");
  document
    .querySelectorAll("[data-note-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.noteTab === tab));
  if (tab === "preview") {
    pv.innerHTML = renderMarkdown(ta.value);
    pv.hidden = false;
    ta.hidden = true;
  } else {
    ta.hidden = false;
    pv.hidden = true;
  }
}

function refreshInspector(node) {
  const empty = $("insp-empty");
  const body = $("insp-body");
  const insp = $("inspector");
  if (!node) {
    empty.hidden = false;
    body.hidden = true;
    insp.classList.remove("open");
    return;
  }
  empty.hidden = true;
  body.hidden = false;
  if (window.innerWidth <= 760) insp.classList.add("open");

  $("insp-text").value = node.text || "";
  $("insp-note").value = node.note || "";
  setNoteTab(node.note && node.note.trim() ? "preview" : "write");
  $("insp-link").value = node.link || "";

  $("insp-icons")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.icon === (node.icon || "")));
  $("insp-colors")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.color === (node.color || "")));

  const hasProg = node.progress != null;
  $("insp-prog-on").checked = hasProg;
  $("insp-prog").disabled = !hasProg;
  $("insp-prog").value = hasProg ? node.progress : 0;
  $("insp-prog-val").textContent = hasProg ? node.progress + "%" : "—";

  const isRoot = node.id === view.doc.root.id;
  const del = $("act-delete");
  del.disabled = isRoot;
  del.style.opacity = isRoot ? 0.4 : 1;
  const hasKids = node.children && node.children.length;
  const fold = $("act-fold");
  fold.disabled = !hasKids;
  fold.style.opacity = hasKids ? 1 : 0.4;
  fold.textContent = node.collapsed ? "Unfold" : "Fold";

  // connections
  const list = $("insp-links");
  list.innerHTML = "";
  const links = view.linksFor(node.id);
  if (!links.length) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "No connections.";
    list.appendChild(p);
  }
  for (const l of links) {
    const otherId = l.from === node.id ? l.to : l.from;
    const other = view._findNode(otherId);
    const row = document.createElement("div");
    row.className = "link-item";
    const arrow = l.from === node.id ? "→ " : "← ";
    const lbl = document.createElement("span");
    lbl.className = "lt";
    lbl.textContent = arrow + (other ? other.node.text || "(untitled)" : "(missing)");
    const labelInput = document.createElement("input");
    labelInput.placeholder = "label";
    labelInput.value = l.label || "";
    labelInput.addEventListener("change", () =>
      view.setLinkLabel(l.from, l.to, labelInput.value.trim())
    );
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.title = "Remove connection";
    rm.addEventListener("click", () => view.removeLink(l.from, l.to));
    row.append(lbl, labelInput, rm);
    list.appendChild(row);
  }
}

/* ---------------- Session ---------------- */
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSession, 400);
}
function persistSession() {
  if (active >= 0 && tabs[active]) tabs[active].state = view.serializeState();
  try {
    const data = {
      active,
      lastTheme,
      tabs: tabs.map((t) => ({
        dirty: t.dirty,
        doc: t.state.doc,
        view: t.state.view,
        selectedId: t.state.selectedId,
      })),
    };
    localStorage.setItem("blumind.session", JSON.stringify(data));
  } catch {}
}
function loadSession() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem("blumind.session") || "null");
  } catch {}
  if (data && Array.isArray(data.tabs) && data.tabs.length) {
    lastTheme = data.lastTheme || lastTheme;
    tabs = data.tabs.map((t) => ({
      tabId: uid(),
      dirty: !!t.dirty,
      state: { doc: t.doc, view: t.view || null, selectedId: t.selectedId, undo: [], redo: [] },
    }));
    active = -1;
    switchTo(Math.min(data.active ?? 0, tabs.length - 1));
  } else {
    addTab(sampleDoc());
  }
}

/* ---------------- Misc ---------------- */
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 200);
  }, 2200);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    saveDoc();
  } else if (mod && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    openSearch();
  } else if (e.key === "Escape" && !$("searchbar").hidden) {
    closeSearch();
  }
});
window.addEventListener("beforeunload", persistSession);

// boot
populateThemes();
initInspector();
bindToolbar();
bindSearch();
loadSession();
