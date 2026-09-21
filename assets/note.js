(function () {
  "use strict";

  const body = document.body;
  const key = "p2h:" + (body.dataset.noteKey || "note");
  const takes = Array.from(document.querySelectorAll(".my-take"));
  const dg = document.getElementById("dg");
  const nodes = dg ? Array.from(dg.querySelectorAll(".node")) : [];
  const edges = dg ? Array.from(dg.querySelectorAll(".edge")) : [];

  const toast = document.getElementById("toast");
  let toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove("show"); }, 1600);
  }

  /* ---------- graph adjacency ---------- */

  const down = {}, up = {};
  edges.forEach((p) => {
    const f = p.getAttribute("data-from"), t = p.getAttribute("data-to");
    (down[f] = down[f] || []).push(t);
    (up[t] = up[t] || []).push(f);
  });

  function walk(start, adj) {
    const seen = {}, stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      (adj[cur] || []).forEach((n) => {
        if (!seen[n] && n !== start) { seen[n] = true; stack.push(n); }
      });
    }
    return seen;
  }

  /* ---------- jump: 平滑滚动优先，兜底瞬时滚动 ---------- */

  const REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function pageY() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  function absTop(el) {
    return el.getBoundingClientRect().top + pageY();
  }

  function scrollableHere() {
    return (document.documentElement.scrollHeight || 0) > window.innerHeight + 2;
  }

  function hardScroll(el) {
    const y = Math.max(0, absTop(el) - 24);
    if (scrollableHere()) {
      window.scrollTo(0, y);
      return;
    }
    // 本窗口没有滚动条：页面多半被嵌在 iframe 里，滚动条在父页面
    try {
      const fe = window.frameElement;
      if (fe && window.parent && window.parent !== window) {
        const fr = fe.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        const py = (window.parent.pageYOffset || 0) + fr.top + er.top - 24;
        window.parent.scrollTo(0, Math.max(0, py));
      }
    } catch (e) { /* cross-origin iframe, ignore */ }
  }

  function jumpTo(el) {
    if (!el) return;
    if (REDUCE) { hardScroll(el); return; }
    const before = pageY();
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch (e) { el.scrollIntoView(); }
    // 平滑滚动在某些环境（预览面板的 iframe、动画被禁用）不会执行，兜住
    setTimeout(() => {
      if (Math.abs(pageY() - before) < 2 && Math.abs(absTop(el) - 24) > 2) hardScroll(el);
    }, 450);
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => { el.classList.remove("flash"); }, 1300);
  }

  function highlight(id, withReach) {
    if (!dg) return;
    if (!id) {
      dg.classList.remove("focusing");
      nodes.forEach((n) => { n.classList.remove("active", "reach"); });
      edges.forEach((e) => { e.classList.remove("on"); });
      document.querySelectorAll(".blk.mod").forEach((b) => { b.classList.remove("active"); });
      return;
    }
    dg.classList.add("focusing");
    const us = withReach ? walk(id, up) : {};
    const ds = withReach ? walk(id, down) : {};
    nodes.forEach((n) => {
      const nid = n.getAttribute("data-id");
      n.classList.remove("active", "reach");
      if (nid === id) n.classList.add("active");
      else if (us[nid] || ds[nid]) n.classList.add("reach");
    });
    edges.forEach((e) => {
      const f = e.getAttribute("data-from"), t = e.getAttribute("data-to");
      const ok = withReach
        ? ((f === id || us[f] || ds[f]) && (t === id || us[t] || ds[t]))
        : (f === id || t === id);
      e.classList.toggle("on", !!ok);
    });
    document.querySelectorAll(".blk.mod").forEach((b) => {
      b.classList.toggle("active", b.id === "mod-" + id);
    });
  }

  nodes.forEach((n) => {
    const id = n.getAttribute("data-id");
    n.addEventListener("click", () => {
      const target = document.getElementById("mod-" + id);
      lockUntil = Date.now() + 1200;
      jumpTo(target);
      flash(target);
      highlight(id, true);
      if (dg) {
        dg.classList.add("tracing");
        clearTimeout(dg._traceTimer);
        dg._traceTimer = setTimeout(() => { dg.classList.remove("tracing"); }, 1000);
      }
    });
    n.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.click(); }
    });
  });

  /* ---------- toc anchors use the same jump path ---------- */

  Array.from(document.querySelectorAll('.toc a[href^="#"]')).forEach((a) => {
    a.addEventListener("click", (e) => {
      const el = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
      if (!el) return;
      e.preventDefault();
      lockUntil = Date.now() + 1200;
      jumpTo(el);
      flash(el);
    });
  });

  /* ---------- scroll spy ----------
     判定「当前章节」用最后越过判定线的卡片，而不是可见面积最大的那个：
     短卡片很容易被下一个盖过去，会导致高亮错到下一个模块。 */

  const cards = Array.from(document.querySelectorAll(".blk"));
  let lockUntil = 0;
  let ticking = false;

  function syncFromScroll() {
    if (!dg || !cards.length || Date.now() < lockUntil) return;
    let best = null, bestDist = Infinity;
    cards.forEach((c) => {
      const d = c.getBoundingClientRect().top - 100;
      if (d <= 0 && -d < bestDist) { bestDist = -d; best = c; }
    });
    if (!best) return;
    if (best.id.startsWith("mod-")) highlight(best.id.slice(4), false);
    else highlight(null, false);
  }

  if (dg && cards.length) {
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; syncFromScroll(); });
    }, { passive: true });
    syncFromScroll();
  }

  /* ---------- my take ---------- */

  function isEmpty(el) { return el.textContent.trim() === ""; }

  function syncEmptyFlags() {
    takes.forEach((el) => {
      el.setAttribute("data-empty", isEmpty(el) ? "true" : "false");
    });
  }

  takes.forEach((el) => {
    const id = el.getAttribute("data-id") || "";
    let saved = null;
    try { saved = localStorage.getItem(key + "|" + id); } catch (e) { console.warn("[note] localStorage read failed:", e); }
    if (saved) { el.innerHTML = sanitizeHtml(saved); }

    el.addEventListener("input", () => {
      try { localStorage.setItem(key + "|" + id, el.innerHTML); } catch (e) { console.warn("[note] localStorage write failed:", e); }
      syncEmptyFlags();
      showToast("已保存");
    });

    el.addEventListener("focus", () => { el.setAttribute("data-empty", "false"); });
    el.addEventListener("blur", () => { syncEmptyFlags(); });

    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
      const html = lines.map((l) => "<div>" + escapeHtml(l) + "</div>").join("");
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const tmp = document.createElement("template");
        tmp.innerHTML = html;
        range.insertNode(tmp.content);
      }
    });
  });

  syncEmptyFlags();

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- HTML sanitizer (whitelist-based, for localStorage restore) ---------- */

  const ALLOWED_TAGS = {
    p:1, div:1, br:1, hr:1,
    h3:1, h4:1,
    ul:1, ol:1, li:1,
    strong:1, em:1, code:1, pre:1, blockquote:1,
    table:1, thead:1, tbody:1, tr:1, th:1, td:1,
    span:1
  };
  const ALLOWED_ATTRS = { "class":1, "data-id":1, "data-empty":1, "data-ph":1 };
  const ATTR_VAL_RE = /^\s*([a-zA-Z][a-zA-Z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/;

  function sanitizeHtml(raw) {
    return String(raw).replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag, rest) => {
      const lo = tag.toLowerCase();
      if (match.charAt(1) === "/") return ALLOWED_TAGS[lo] ? "</" + lo + ">" : "";
      if (!ALLOWED_TAGS[lo]) return "";
      let attrs = "";
      let r = rest.replace(/^\s+/, "");
      while (r.length) {
        const m = r.match(ATTR_VAL_RE);
        if (!m) break;
        const aname = m[1].toLowerCase();
        const aval = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] || ""));
        r = r.slice(m[0].length);
        if (aname.charAt(0) === "o") continue;
        if (!ALLOWED_ATTRS[aname]) continue;
        if ((aname === "class" || aname.startsWith("data-")) && /[<>"'`]/.test(aval)) continue;
        attrs += " " + aname + '="' + escapeHtml(aval) + '"';
      }
      return "<" + lo + attrs + ">";
    });
  }

  function safeName(s) {
    return (s || "paper-note").replace(/[\\/:*?"<>|\n\r\t]/g, "_").slice(0, 60);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- theme ---------- */

  const btnTheme = document.getElementById("btn-theme");
  function applyTheme(t) {
    body.setAttribute("data-theme", t);
    if (btnTheme) btnTheme.textContent = t === "dark" ? "亮色" : "暗色";
    try { localStorage.setItem("p2h-theme", t); } catch (e) { console.warn("[note] theme save failed:", e); }
  }
  let savedTheme = null;
  try { savedTheme = localStorage.getItem("p2h-theme"); } catch (e) { /* ignore */ }
  applyTheme(savedTheme === "dark" ? "dark" : "light");
  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      applyTheme(body.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  }

  /* ---------- export html ---------- */

  const btnHtml = document.getElementById("btn-html");
  if (btnHtml) {
    btnHtml.addEventListener("click", () => {
      highlight(null, false);
      syncEmptyFlags();
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll(".my-take").forEach((el) => {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-empty");
        el.removeAttribute("data-ph");
      });
      clone.querySelectorAll(".take-label").forEach((el) => { el.remove(); });
      const out = "<!DOCTYPE html>\n" + clone.outerHTML;
      download(safeName(document.title || "paper-note") + ".html", out, "text/html");
      showToast("已导出 HTML");
    });
  }

  /* ---------- resolve css vars for standalone svg ---------- */

  function resolveVars(svg) {
    const cs = window.getComputedStyle(body);
    const cache = {};
    function val(name) {
      if (!(name in cache)) cache[name] = cs.getPropertyValue(name).trim();
      return cache[name];
    }
    function subst(str) {
      return str.replace(/var\((--[a-z0-9-]+)\)/gi, (_m, n) => val(n) || "#888");
    }
    const all = [svg, ...svg.querySelectorAll("*")];
    all.forEach((el) => {
      ["fill", "stroke", "font-family"].forEach((attr) => {
        const v = el.getAttribute(attr);
        if (v && v.includes("var(")) el.setAttribute(attr, subst(v));
      });
    });
    return svg;
  }

  function buildStandaloneSvg() {
    if (!dg) return null;
    const vb = (dg.getAttribute("viewBox") || "0 0 600 400").split(/\s+/);
    const clone = resolveVars(dg.cloneNode(true));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", vb[2]);
    clone.setAttribute("height", vb[3]);
    clone.removeAttribute("id");
    clone.removeAttribute("class");
    clone.querySelectorAll(".node.active, .node.reach").forEach((n) => { n.setAttribute("class", ""); });
    clone.querySelectorAll(".edge").forEach((e) => { e.setAttribute("class", ""); });
    return { node: clone, w: parseFloat(vb[2]), h: parseFloat(vb[3]) };
  }

  const btnSvg = document.getElementById("btn-svg");
  if (btnSvg) {
    btnSvg.addEventListener("click", () => {
      const built = buildStandaloneSvg();
      if (!built) { showToast("没有流程图"); return; }
      const s = new XMLSerializer().serializeToString(built.node);
      download(safeName(document.title || "paper-note") + "-图.svg",
        '<?xml version="1.0" encoding="UTF-8"?>\n' + s, "image/svg+xml");
      showToast("已导出 SVG");
    });
  }

  const btnPng = document.getElementById("btn-png");
  if (btnPng) {
    btnPng.addEventListener("click", () => {
      const built = buildStandaloneSvg();
      if (!built) { showToast("没有流程图"); return; }
      const s = new XMLSerializer().serializeToString(built.node);
      const scale = 2;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(built.w * scale);
        canvas.height = Math.round(built.h * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = window.getComputedStyle(body).getPropertyValue("--bg").trim() || "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = safeName(document.title || "paper-note") + "-图.png";
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
          showToast("已导出 PNG");
        }, "image/png");
      };
      img.onerror = () => { showToast("PNG 生成失败，请先导出 SVG"); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
    });
  }

  /* ---------- export markdown ---------- */

  function nodeToMd(el) {
    const t = el.tagName.toLowerCase();
    if (t === "p" || t === "div") return el.innerText.trim();
    if (t === "h3") return "### " + el.innerText.trim();
    if (t === "h4") return "#### " + el.innerText.trim();
    if (t === "pre") return "```\n" + el.innerText + "\n```";
    if (t === "blockquote") return el.innerText.trim().split(/\r?\n/).map((l) => "> " + l).join("\n");
    if (t === "figure") {
      const img = el.querySelector("img");
      const cap = el.querySelector("figcaption");
      const src = img ? img.getAttribute("src") : "";
      const alt = cap ? cap.innerText.trim() : "";
      return src ? "![" + alt + "](" + src + ")" : alt;
    }
    if (t === "ul" || t === "ol") {
      return Array.from(el.children).map((li, i) => {
        return (t === "ol" ? (i + 1) + ". " : "- ") + li.innerText.trim();
      }).join("\n");
    }
    if (t === "table") {
      const rows = Array.from(el.querySelectorAll("tr"));
      const md = rows.map((tr) => {
        return "| " + Array.from(tr.children).map((c) => {
          return c.innerText.trim().replace(/\|/g, "\\|");
        }).join(" | ") + " |";
      });
      if (md.length) md.splice(1, 0, "| " + new Array(rows[0].children.length).fill("---").join(" | ") + " |");
      return md.join("\n");
    }
    return el.innerText.trim();
  }

  function sectionToMd(container, quote) {
    const out = [];
    Array.from(container.children).forEach((el) => {
      const md = nodeToMd(el);
      if (!md) return;
      out.push(quote ? md.split(/\r?\n/).map((l) => "> " + l).join("\n") : md);
    });
    return out.join("\n\n");
  }

  function mermaidOf() {
    if (!nodes.length) return "";
    const lines = ["```mermaid", "flowchart TD"];
    nodes.forEach((n) => {
      const id = n.getAttribute("data-id");
      const label = (n.querySelector("text") || {}).textContent || id;
      lines.push("  " + id + '["' + label.replace(/"/g, "") + '"]');
    });
    edges.forEach((e) => {
      lines.push("  " + e.getAttribute("data-from") + " --> " + e.getAttribute("data-to"));
    });
    lines.push("```");
    return lines.join("\n");
  }

  const btnMd = document.getElementById("btn-md");
  if (btnMd) {
    btnMd.addEventListener("click", () => {
      const lines = ["# " + (document.title || "论文精读笔记"), ""];
      const meta = document.querySelector(".meta");
      if (meta) { lines.push(meta.innerText.trim().replace(/\n+/g, "  \n")); lines.push(""); }
      const m = mermaidOf();
      if (m) { lines.push("## 方法管线"); lines.push(""); lines.push(m); lines.push(""); }
      document.querySelectorAll(".blk").forEach((blk) => {
        const h2 = blk.querySelector("h2");
        const ai = blk.querySelector(".ai-body");
        const take = blk.querySelector(".my-take");
        if (h2) { lines.push("## " + h2.innerText.trim()); lines.push(""); }
        if (ai) { const am = sectionToMd(ai, false); if (am) { lines.push(am); lines.push(""); } }
        if (take && !isEmpty(take)) {
          lines.push("> **我的心得**"); lines.push(">");
          lines.push(sectionToMd(take, true)); lines.push("");
        }
      });
      download(safeName(document.title || "paper-note") + ".md", lines.join("\n"), "text/markdown");
      showToast("已导出 Markdown");
    });
  }

  /* ---------- print / clear ---------- */

  const btnPrint = document.getElementById("btn-print");
  if (btnPrint) btnPrint.addEventListener("click", () => { window.print(); });

  const btnClear = document.getElementById("btn-clear");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      if (!window.confirm("清空所有「我的心得」？此操作不可撤销。")) return;
      takes.forEach((el) => {
        const id = el.getAttribute("data-id") || "";
        try { localStorage.removeItem(key + "|" + id); } catch (e) { console.warn("[note] localStorage remove failed:", e); }
        el.innerHTML = "";
      });
      syncEmptyFlags();
      showToast("已清空心得");
    });
  }
})();
