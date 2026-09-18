(function () {
  "use strict";

  var body = document.body;
  var key = "p2h:" + (body.dataset.noteKey || "note");
  var takes = Array.prototype.slice.call(document.querySelectorAll(".my-take"));
  var dg = document.getElementById("dg");
  var nodes = dg ? Array.prototype.slice.call(dg.querySelectorAll(".node")) : [];
  var edges = dg ? Array.prototype.slice.call(dg.querySelectorAll(".edge")) : [];

  var toast = document.getElementById("toast");
  var toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 1600);
  }

  /* ---------- graph adjacency ---------- */

  var down = {}, up = {};
  edges.forEach(function (p) {
    var f = p.getAttribute("data-from"), t = p.getAttribute("data-to");
    (down[f] = down[f] || []).push(t);
    (up[t] = up[t] || []).push(f);
  });

  function walk(start, adj) {
    var seen = {}, stack = [start];
    while (stack.length) {
      var cur = stack.pop();
      (adj[cur] || []).forEach(function (n) {
        if (!seen[n] && n !== start) { seen[n] = true; stack.push(n); }
      });
    }
    return seen;
  }

  /* ---------- jump: 平滑滚动优先，兜底瞬时滚动 ---------- */

  var REDUCE = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    var y = Math.max(0, absTop(el) - 24);
    if (scrollableHere()) {
      window.scrollTo(0, y);
      return;
    }
    // 本窗口没有滚动条：页面多半被嵌在 iframe 里，滚动条在父页面
    try {
      var fe = window.frameElement;
      if (fe && window.parent && window.parent !== window) {
        var fr = fe.getBoundingClientRect();
        var er = el.getBoundingClientRect();
        var py = (window.parent.pageYOffset || 0) + fr.top + er.top - 24;
        window.parent.scrollTo(0, Math.max(0, py));
      }
    } catch (e) {}
  }

  function jumpTo(el) {
    if (!el) return;
    if (REDUCE) { hardScroll(el); return; }
    var before = pageY();
    try { el.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch (e) { el.scrollIntoView(); }
    // 平滑滚动在某些环境（预览面板的 iframe、动画被禁用）不会执行，兜住
    setTimeout(function () {
      if (Math.abs(pageY() - before) < 2 && Math.abs(absTop(el) - 24) > 2) hardScroll(el);
    }, 450);
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(function () { el.classList.remove("flash"); }, 1300);
  }

  function highlight(id, withReach) {
    if (!dg) return;
    if (!id) {
      dg.classList.remove("focusing");
      nodes.forEach(function (n) { n.classList.remove("active", "reach"); });
      edges.forEach(function (e) { e.classList.remove("on"); });
      Array.prototype.forEach.call(document.querySelectorAll(".blk.mod"), function (b) {
        b.classList.remove("active");
      });
      return;
    }
    dg.classList.add("focusing");
    var us = withReach ? walk(id, up) : {};
    var ds = withReach ? walk(id, down) : {};
    nodes.forEach(function (n) {
      var nid = n.getAttribute("data-id");
      n.classList.remove("active", "reach");
      if (nid === id) n.classList.add("active");
      else if (us[nid] || ds[nid]) n.classList.add("reach");
    });
    edges.forEach(function (e) {
      var f = e.getAttribute("data-from"), t = e.getAttribute("data-to");
      var ok = withReach
        ? ((f === id || us[f] || ds[f]) && (t === id || us[t] || ds[t]))
        : (f === id || t === id);
      e.classList.toggle("on", !!ok);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".blk.mod"), function (b) {
      b.classList.toggle("active", b.id === "mod-" + id);
    });
  }

  nodes.forEach(function (n) {
    var id = n.getAttribute("data-id");
    n.addEventListener("click", function () {
      var target = document.getElementById("mod-" + id);
      lockUntil = Date.now() + 1200;
      jumpTo(target);
      flash(target);
      highlight(id, true);
      if (dg) {
        dg.classList.add("tracing");
        clearTimeout(dg._traceTimer);
        dg._traceTimer = setTimeout(function () { dg.classList.remove("tracing"); }, 1000);
      }
    });
    n.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.click(); }
    });
  });

  /* ---------- toc anchors use the same jump path ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('.toc a[href^="#"]'), function (a) {
    a.addEventListener("click", function (e) {
      var el = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
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

  var cards = Array.prototype.slice.call(document.querySelectorAll(".blk"));
  var lockUntil = 0;
  var ticking = false;

  function syncFromScroll() {
    if (!dg || !cards.length || Date.now() < lockUntil) return;
    var best = null, bestDist = Infinity;
    cards.forEach(function (c) {
      var d = c.getBoundingClientRect().top - 100;
      if (d <= 0 && -d < bestDist) { bestDist = -d; best = c; }
    });
    if (!best) return;
    if (best.id.indexOf("mod-") === 0) highlight(best.id.slice(4), false);
    else highlight(null, false);
  }

  if (dg && cards.length) {
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; syncFromScroll(); });
    }, { passive: true });
    syncFromScroll();
  }

  /* ---------- my take ---------- */

  function isEmpty(el) { return el.textContent.trim() === ""; }

  function syncEmptyFlags() {
    takes.forEach(function (el) {
      el.setAttribute("data-empty", isEmpty(el) ? "true" : "false");
    });
  }

  takes.forEach(function (el) {
    var id = el.getAttribute("data-id") || "";
    var saved = null;
    try { saved = localStorage.getItem(key + "|" + id); } catch (e) {}
    if (saved) { el.innerHTML = saved; }

    el.addEventListener("input", function () {
      try { localStorage.setItem(key + "|" + id, el.innerHTML); } catch (e) {}
      syncEmptyFlags();
      showToast("已保存");
    });

    el.addEventListener("focus", function () { el.setAttribute("data-empty", "false"); });
    el.addEventListener("blur", function () { syncEmptyFlags(); });

    el.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
      document.execCommand("insertHTML", false,
        lines.map(function (l) { return "<div>" + escapeHtml(l) + "</div>"; }).join(""));
    });
  });

  syncEmptyFlags();

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function safeName(s) {
    return (s || "paper-note").replace(/[\\/:*?"<>|\n\r\t]/g, "_").slice(0, 60);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- theme ---------- */

  var btnTheme = document.getElementById("btn-theme");
  function applyTheme(t) {
    body.setAttribute("data-theme", t);
    if (btnTheme) btnTheme.textContent = t === "dark" ? "亮色" : "暗色";
    try { localStorage.setItem("p2h-theme", t); } catch (e) {}
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem("p2h-theme"); } catch (e) {}
  applyTheme(savedTheme === "dark" ? "dark" : "light");
  if (btnTheme) {
    btnTheme.addEventListener("click", function () {
      applyTheme(body.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  }

  /* ---------- export html ---------- */

  var btnHtml = document.getElementById("btn-html");
  if (btnHtml) {
    btnHtml.addEventListener("click", function () {
      highlight(null, false);
      syncEmptyFlags();
      var clone = document.documentElement.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll(".my-take"), function (el) {
        el.removeAttribute("contenteditable");
        el.removeAttribute("data-empty");
        el.removeAttribute("data-ph");
      });
      Array.prototype.forEach.call(clone.querySelectorAll(".take-label"), function (el) { el.remove(); });
      var out = "<!DOCTYPE html>\n" + clone.outerHTML;
      download(safeName(document.title || "paper-note") + ".html", out, "text/html");
      showToast("已导出 HTML");
    });
  }

  /* ---------- resolve css vars for standalone svg ---------- */

  function resolveVars(svg) {
    var cs = window.getComputedStyle(body);
    var cache = {};
    function val(name) {
      if (!(name in cache)) cache[name] = cs.getPropertyValue(name).trim();
      return cache[name];
    }
    function subst(str) {
      return str.replace(/var\((--[a-z0-9-]+)\)/gi, function (m, n) {
        var v = val(n);
        return v || "#888";
      });
    }
    var all = [svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*")));
    all.forEach(function (el) {
      ["fill", "stroke", "font-family"].forEach(function (attr) {
        var v = el.getAttribute(attr);
        if (v && v.indexOf("var(") !== -1) el.setAttribute(attr, subst(v));
      });
    });
    return svg;
  }

  function buildStandaloneSvg() {
    if (!dg) return null;
    var vb = (dg.getAttribute("viewBox") || "0 0 600 400").split(/\s+/);
    var clone = resolveVars(dg.cloneNode(true));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", vb[2]);
    clone.setAttribute("height", vb[3]);
    clone.removeAttribute("id");
    clone.removeAttribute("class");
    Array.prototype.forEach.call(clone.querySelectorAll(".node.active, .node.reach"), function (n) {
      n.setAttribute("class", "");
    });
    Array.prototype.forEach.call(clone.querySelectorAll(".edge"), function (e) { e.setAttribute("class", ""); });
    return { node: clone, w: parseFloat(vb[2]), h: parseFloat(vb[3]) };
  }

  var btnSvg = document.getElementById("btn-svg");
  if (btnSvg) {
    btnSvg.addEventListener("click", function () {
      var built = buildStandaloneSvg();
      if (!built) { showToast("没有流程图"); return; }
      var s = new XMLSerializer().serializeToString(built.node);
      download(safeName(document.title || "paper-note") + "-图.svg",
        '<?xml version="1.0" encoding="UTF-8"?>\n' + s, "image/svg+xml");
      showToast("已导出 SVG");
    });
  }

  var btnPng = document.getElementById("btn-png");
  if (btnPng) {
    btnPng.addEventListener("click", function () {
      var built = buildStandaloneSvg();
      if (!built) { showToast("没有流程图"); return; }
      var s = new XMLSerializer().serializeToString(built.node);
      var scale = 2;
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(built.w * scale);
        canvas.height = Math.round(built.h * scale);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = window.getComputedStyle(body).getPropertyValue("--bg").trim() || "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = safeName(document.title || "paper-note") + "-图.png";
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          showToast("已导出 PNG");
        }, "image/png");
      };
      img.onerror = function () { showToast("PNG 生成失败，请先导出 SVG"); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
    });
  }

  /* ---------- export markdown ---------- */

  function nodeToMd(el) {
    var t = el.tagName.toLowerCase();
    if (t === "p" || t === "div") return el.innerText.trim();
    if (t === "h3") return "### " + el.innerText.trim();
    if (t === "h4") return "#### " + el.innerText.trim();
    if (t === "pre") return "```\n" + el.innerText + "\n```";
    if (t === "blockquote") return el.innerText.trim().split(/\r?\n/).map(function (l) { return "> " + l; }).join("\n");
    if (t === "ul" || t === "ol") {
      return Array.prototype.slice.call(el.children).map(function (li, i) {
        return (t === "ol" ? (i + 1) + ". " : "- ") + li.innerText.trim();
      }).join("\n");
    }
    if (t === "table") {
      var rows = Array.prototype.slice.call(el.querySelectorAll("tr"));
      var md = rows.map(function (tr) {
        return "| " + Array.prototype.slice.call(tr.children).map(function (c) {
          return c.innerText.trim().replace(/\|/g, "\\|");
        }).join(" | ") + " |";
      });
      if (md.length) md.splice(1, 0, "| " + new Array(rows[0].children.length).fill("---").join(" | ") + " |");
      return md.join("\n");
    }
    return el.innerText.trim();
  }

  function sectionToMd(container, quote) {
    var out = [];
    Array.prototype.forEach.call(container.children, function (el) {
      var md = nodeToMd(el);
      if (!md) return;
      out.push(quote ? md.split(/\r?\n/).map(function (l) { return "> " + l; }).join("\n") : md);
    });
    return out.join("\n\n");
  }

  function mermaidOf() {
    if (!nodes.length) return "";
    var lines = ["```mermaid", "flowchart TD"];
    nodes.forEach(function (n) {
      var id = n.getAttribute("data-id");
      var label = (n.querySelector("text") || {}).textContent || id;
      lines.push("  " + id + '["' + label.replace(/"/g, "") + '"]');
    });
    edges.forEach(function (e) {
      lines.push("  " + e.getAttribute("data-from") + " --> " + e.getAttribute("data-to"));
    });
    lines.push("```");
    return lines.join("\n");
  }

  var btnMd = document.getElementById("btn-md");
  if (btnMd) {
    btnMd.addEventListener("click", function () {
      var lines = ["# " + (document.title || "论文精读笔记"), ""];
      var meta = document.querySelector(".meta");
      if (meta) { lines.push(meta.innerText.trim().replace(/\n+/g, "  \n")); lines.push(""); }
      var m = mermaidOf();
      if (m) { lines.push("## 方法管线"); lines.push(""); lines.push(m); lines.push(""); }
      Array.prototype.forEach.call(document.querySelectorAll(".blk"), function (blk) {
        var h2 = blk.querySelector("h2");
        var ai = blk.querySelector(".ai-body");
        var take = blk.querySelector(".my-take");
        if (h2) { lines.push("## " + h2.innerText.trim()); lines.push(""); }
        if (ai) { var am = sectionToMd(ai, false); if (am) { lines.push(am); lines.push(""); } }
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

  var btnPrint = document.getElementById("btn-print");
  if (btnPrint) btnPrint.addEventListener("click", function () { window.print(); });

  var btnClear = document.getElementById("btn-clear");
  if (btnClear) {
    btnClear.addEventListener("click", function () {
      if (!window.confirm("清空所有「我的心得」？此操作不可撤销。")) return;
      takes.forEach(function (el) {
        var id = el.getAttribute("data-id") || "";
        try { localStorage.removeItem(key + "|" + id); } catch (e) {}
        el.innerHTML = "";
      });
      syncEmptyFlags();
      showToast("已清空心得");
    });
  }
})();
