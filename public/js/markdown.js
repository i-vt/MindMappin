// Minimal, dependency-free Markdown -> HTML renderer for topic notes.
// Covers the common GitHub-Flavored-Markdown subset: headings, bold/italic/
// strikethrough, inline code, fenced code blocks, links/images/autolinks,
// blockquotes, ordered/unordered lists, task lists, tables, and rules.
//
// Security: the source is HTML-escaped up front, so no raw HTML can be
// injected; only the tags this renderer emits ever reach the DOM. URLs are
// sanitized to http(s)/mailto/relative only.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeUrl(url) {
  const u = (url || "").trim().replace(/&quot;/g, "");
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[#/.]/.test(u)) return u; // relative / anchor
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(u)) return "mailto:" + u;
  return "#";
}

function inline(text) {
  if (text == null) return "";
  let s = String(text);
  const codes = [];
  const stash = (c) => {
    codes.push(c);
    return "\u0001" + (codes.length - 1) + "\u0001";
  };
  // inline code (double then single backticks)
  s = s.replace(/``([^`]+?)``/g, (_, c) => stash(c));
  s = s.replace(/`([^`]+?)`/g, (_, c) => stash(c));
  // images
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^]*?)&quot;)?\)/g,
    (_, alt, url, title) =>
      `<img src="${sanitizeUrl(url)}" alt="${alt}"${title ? ` title="${title}"` : ""}>`
  );
  // links
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^]*?)&quot;)?\)/g,
    (_, label, url, title) =>
      `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer"${
        title ? ` title="${title}"` : ""
      }>${label}</a>`
  );
  // angle-bracket autolinks (escaped as &lt; &gt;)
  s = s.replace(
    /&lt;(https?:\/\/[^\s&]+)&gt;/g,
    (_, url) => `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  s = s.replace(/&lt;([\w.+-]+@[\w.-]+\.\w+)&gt;/g, (_, m) => `<a href="mailto:${m}">${m}</a>`);
  // bare URL autolinks (not already inside an attribute/tag)
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_, pre, url) =>
      `${pre}<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
  // emphasis
  s = s.replace(/\*\*(?=\S)([^]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__(?=\S)([^]*?\S)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/\*(?=\S)([^*\n]*?\S)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w*])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~(?=\S)([^]*?\S)~~/g, "<del>$1</del>");
  // restore inline code
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

function splitRow(r) {
  let s = r.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function renderTable(lines) {
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((s) => {
    const l = s.startsWith(":");
    const r = s.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
  const cell = (tag, txt, i) =>
    `<${tag}${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${inline(txt)}</${tag}>`;
  let html = "<table><thead><tr>";
  head.forEach((h, i) => (html += cell("th", h, i)));
  html += "</tr></thead><tbody>";
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitRow(lines[i]);
    html += "<tr>";
    for (let c = 0; c < head.length; c++) html += cell("td", cells[c] || "", c);
    html += "</tr>";
  }
  return html + "</tbody></table>";
}

function renderList(lines) {
  const items = [];
  const stack = [{ indent: -1, children: items }];
  for (const line of lines) {
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) {
      const top = stack[stack.length - 1];
      if (top.content != null) top.content += "\n" + line.trim();
      continue;
    }
    const indent = m[1].replace(/\t/g, "    ").length;
    const ordered = /\d/.test(m[2]);
    let content = m[3];
    let checked = null;
    const t = content.match(/^\[([ xX])\]\s+(.*)$/);
    if (t) {
      checked = t[1].toLowerCase() === "x";
      content = t[2];
    }
    const item = { indent, ordered, checked, content, children: [] };
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  return buildList(items);
}
function buildList(items) {
  if (!items.length) return "";
  const tag = items[0].ordered ? "ol" : "ul";
  let html = `<${tag}>`;
  for (const it of items) {
    const inner = inline(it.content.replace(/\n+/g, " "));
    const sub = it.children.length ? buildList(it.children) : "";
    if (it.checked !== null) {
      html += `<li class="md-task"><input type="checkbox" disabled${
        it.checked ? " checked" : ""
      }> ${inner}${sub}</li>`;
    } else {
      html += `<li>${inner}${sub}</li>`;
    }
  }
  return html + `</${tag}>`;
}

function renderBlocks(lines) {
  let html = "";
  let para = [];
  const flush = () => {
    if (!para.length) return;
    let out = "";
    for (let k = 0; k < para.length; k++) {
      const ln = para[k];
      out += ln.replace(/\s+$/, "");
      if (k < para.length - 1) out += /(\s{2,}|\\)$/.test(ln) ? "<br>" : " ";
    }
    html += "<p>" + inline(out) + "</p>";
    para = [];
  };
  const sep = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      flush();
      i++;
      continue;
    }
    if (/^\u0000CODE\d+\u0000$/.test(line.trim())) {
      flush();
      html += line.trim();
      i++;
      continue;
    }
    let m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) {
      flush();
      html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flush();
      html += "<hr>";
      i++;
      continue;
    }
    if (/^\s*&gt;/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ""));
        i++;
      }
      html += "<blockquote>" + renderBlocks(buf) + "</blockquote>";
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && sep.test(lines[i + 1])) {
      flush();
      const buf = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        buf.push(lines[i]);
        i++;
      }
      html += renderTable(buf);
      continue;
    }
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].trim()) {
        if (/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) || /^\s+\S/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        } else break;
      }
      html += renderList(buf);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return html;
}

function extractFences(escaped) {
  const lines = escaped.split("\n");
  const codes = [];
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^\s*```+\s*([\w+#-]*)\s*$/);
    if (m) {
      const lang = m[1] || "";
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const cls = lang ? ` class="language-${lang}"` : "";
      codes.push(`<pre class="md-pre"><code${cls}>${buf.join("\n")}</code></pre>`);
      out.push("\u0000CODE" + (codes.length - 1) + "\u0000");
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return { text: out.join("\n"), codes };
}

export function renderMarkdown(src) {
  if (!src || !src.trim()) return '<p class="md-empty">Nothing to preview.</p>';
  const escaped = escapeHtml(src.replace(/\r\n?/g, "\n"));
  const { text, codes } = extractFences(escaped);
  let html = renderBlocks(text.split("\n"));
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codes[+i] || "");
  return html;
}
