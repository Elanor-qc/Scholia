#!/usr/bin/env python3
"""把论文精读内容 JSON 渲染成单文件、可编辑的 HTML 笔记。

正文顺序：结论 → 问题 → 【横向方法管线图】→ 图上各模块详解 → 实验 → ……
图上的节点可点击跳转到对应详解章节。
各 module / block 可嵌入论文原图（base64 内联），放在文字详解上方。

用法:
    python build_note.py --content content.json --out "论文精读笔记.html"

content.json 结构:
{
  "meta": {...},
  "diagram": {
    "title": "方法管线",
    "after": "problem",              # 图插在这个 block 之后；不指定则放在正文最前
    "nodes": [
      {"id":"gauss","label":"各向异性高斯","sub":"Σ = R S Sᵀ Rᵀ","kind":"latent","col":2,"row":0}
    ],
    "edges": [{"from":"init","to":"gauss","label":"初始化属性"}]
  },
  "modules": [{"id":"gauss","title":"表示：各向异性高斯","html":"<p>...</p>",
               "figure":{"src":"fig3.png","caption":"图注"},"ph":"可选"}],
  "blocks": [{"id":"problem","title":"要解决什么问题","html":"<p>...</p>",
              "figure":{"src":"fig1.png","caption":"..."}}]
}

横向布局约定：主干走 row 0，col 从左到右递增；辅助/损失模块下挂到 row 1。
kind 取值: io(输入/输出) proc(处理) latent(表示/latent) loss(损失/监督) aux(辅助/可选)
"""

import argparse
import base64
import html
import json
import os
import re
import sys
from string import Template

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")

DEFAULT_TAKE_PLACEHOLDER = "写点什么：和我的工作有什么关系？值不值得复现？哪里没看懂？"

META_FIELDS = [
    ("authors", "作者", False),
    ("affiliation", "机构", False),
    ("venue", "发表于", False),
    ("arxiv", "arXiv", False),
    ("url", "原文", True),
    ("code", "代码", True),
    ("date", "阅读于", False),
]

KINDS = [
    ("io", "输入 / 输出"),
    ("proc", "处理模块"),
    ("latent", "表示 / latent"),
    ("loss", "损失 / 监督"),
    ("aux", "辅助 / 可选"),
]

# ---- diagram geometry (horizontal flow) ----
NODE_W = 128
NODE_H = 54
COL_GAP = 42
ROW_GAP = 38
PAD = 16
BUS_EXTRA = 30   # 回边通道额外高度


class BuildError(Exception):
    """构建过程中的可预期错误，消息直接展示给用户。"""
    pass


def esc(s):
    return html.escape(str(s), quote=False)


# ---- figure embedding ----

MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


def embed_figure(figure, content_dir):
    """把 figure 字段转成 <figure><img><figcaption></figure> HTML。

    figure 格式: {"src": "相对路径", "caption": "可选图注"}
    图片读取后内联为 base64 data URI，保持单文件自包含。
    """
    src = figure.get("src", "")
    if not src:
        return ""
    path = os.path.join(content_dir, src)
    if not os.path.exists(path):
        print("[build_note] 警告: 图片不存在，已跳过: %s" % path, file=sys.stderr)
        return ""
    ext = os.path.splitext(src)[1].lower()
    mime = MIME_MAP.get(ext)
    if not mime:
        print("[build_note] 警告: 不支持的图片格式 %s，跳过: %s" % (ext, path), file=sys.stderr)
        return ""
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("ascii")
    data_uri = "data:%s;base64,%s" % (mime, data)
    caption = figure.get("caption", "")
    fig = '<figure class="paper-fig"><img src="%s" alt="%s"' % (data_uri, esc(caption))
    fig += ' loading="lazy"></img>'
    if caption:
        fig += '\n<figcaption>%s</figcaption>' % esc(caption)
    fig += '</figure>'
    return fig


def load_asset(name):
    path = os.path.join(ASSETS, name)
    if not os.path.exists(path):
        raise BuildError("[build_note] 缺少资源文件: %s" % path)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def slug(s):
    s = re.sub(r"\s+", "-", str(s).strip().lower())
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff\-]", "", s)
    return s[:60] or "note"


# ---------------------------------------------------------------- meta

def build_meta(meta):
    lines = []
    for key, label, is_link in META_FIELDS:
        val = meta.get(key)
        if not val:
            continue
        if key == "arxiv" and not str(val).startswith("http"):
            href = "https://arxiv.org/abs/%s" % val
            lines.append('<div><span class="lbl">%s</span><a href="%s" target="_blank" rel="noopener">%s</a></div>'
                         % (label, esc(href), esc(val)))
            continue
        if is_link:
            lines.append('<div><span class="lbl">%s</span><a href="%s" target="_blank" rel="noopener">%s</a></div>'
                         % (label, esc(val), esc(val)))
        else:
            lines.append('<div><span class="lbl">%s</span>%s</div>' % (label, esc(val)))
    return "\n      ".join(lines)


def build_tags(meta):
    tags = meta.get("tags") or []
    if not tags:
        return ""
    return '<div class="tags">%s</div>' % "".join("<span>%s</span>" % esc(t) for t in tags)


# ---------------------------------------------------------------- diagram

def validate_diagram(d):
    nodes = d.get("nodes") or []
    if not nodes:
        return None
    by_id = {}
    for n in nodes:
        for f in ("id", "label", "col", "row"):
            if f not in n:
                raise BuildError("[build_note] diagram 节点缺字段 %s: %r" % (f, n))
        by_id[n["id"]] = n
    for e in d.get("edges") or []:
        if e.get("from") not in by_id or e.get("to") not in by_id:
            raise BuildError("[build_note] edges 引用了不存在的节点: %r" % e)
    return by_id


def col_x(c):
    return PAD + c * (NODE_W + COL_GAP)


def row_y(r):
    return PAD + r * (NODE_H + ROW_GAP)


def route(a, b, bus_b):
    """横向主干的手工路由，返回 (path_d, label_x, label_y, anchor)。"""
    ax, ay = col_x(a["col"]), row_y(a["row"])
    bx, by = col_x(b["col"]), row_y(b["row"])
    a_cx, b_cx = ax + NODE_W / 2, bx + NODE_W / 2
    a_cy, b_cy = ay + NODE_H / 2, by + NODE_H / 2

    if a["row"] == b["row"]:
        if b["col"] > a["col"]:
            # 主干前进
            return ("M%d %d L%d %d" % (ax + NODE_W, a_cy, bx - 3, b_cy),
                    (ax + NODE_W + bx) / 2, a_cy - 9, "middle")
        # 回边：走下方公共通道
        return ("M%d %d L%d %d L%d %d L%d %d" % (a_cx, ay + NODE_H, a_cx, bus_b, b_cx, bus_b, b_cx, by + NODE_H + 3),
                (a_cx + b_cx) / 2, bus_b - 7, "middle")

    # 同一列的上下行连线要左右错开，否则一来一回两条边会重叠
    off = 0
    if a["col"] == b["col"]:
        off = -15 if b["row"] > a["row"] else 15

    if b["row"] > a["row"]:
        # 下挂分支
        mid = (ay + NODE_H + by) / 2
        x = a_cx + off
        return ("M%.1f %d L%.1f %.1f L%.1f %.1f L%.1f %d"
                % (x, ay + NODE_H, x, mid, b_cx + off, mid, b_cx + off, by - 3),
                x + 7, mid, "start")

    # 上行汇回主干
    mid = (ay + by + NODE_H) / 2
    x = a_cx + off
    return ("M%.1f %d L%.1f %.1f L%.1f %.1f L%.1f %d"
            % (x, ay, x, mid, b_cx + off, mid, b_cx + off, by + NODE_H + 3),
            x + 7, mid, "start")


def render_diagram(d):
    by_id = validate_diagram(d)
    if by_id is None:
        return ""

    nodes = d["nodes"]
    edges = d.get("edges") or []
    max_col = max(n["col"] for n in nodes)
    max_row = max(n["row"] for n in nodes)
    width = PAD + (max_col + 1) * (NODE_W + COL_GAP) - COL_GAP + PAD
    base_h = PAD + (max_row + 1) * (NODE_H + ROW_GAP) - ROW_GAP + PAD
    has_back = any(by_id[e["to"]]["row"] == by_id[e["from"]]["row"]
                   and by_id[e["to"]]["col"] < by_id[e["from"]]["col"] for e in edges)
    height = base_h + (BUS_EXTRA if has_back else 0)
    bus_b = height - 12

    parts = []
    parts.append('<svg class="dg" id="dg" viewBox="0 0 %d %d" width="%d" height="%d" '
                 'style="min-width:%dpx" xmlns="http://www.w3.org/2000/svg" font-family="var(--font-sans)">'
                 % (width, height, width, height, width))
    parts.append('<defs><marker id="dg-arrow" viewBox="0 0 10 10" refX="8" refY="5" '
                 'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
                 '<path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" '
                 'stroke-linecap="round" stroke-linejoin="round"/></marker></defs>')

    for e in edges:
        a, b = by_id[e["from"]], by_id[e["to"]]
        path, lx, ly, anchor = route(a, b, bus_b)
        parts.append('<path class="edge" data-from="%s" data-to="%s" d="%s" fill="none" '
                     'stroke="var(--dg-edge)" stroke-width="1.4" marker-end="url(#dg-arrow)"/>'
                     % (esc(a["id"]), esc(b["id"]), path))
        if e.get("label"):
            parts.append('<text class="elabel" data-edge-label="%s|%s" x="%.1f" y="%.1f" '
                         'text-anchor="%s" font-size="10.5" fill="var(--dg-elabel)">%s</text>'
                         % (esc(a["id"]), esc(b["id"]), lx, ly, anchor, esc(e["label"])))

    for n in nodes:
        x, y = col_x(n["col"]), row_y(n["row"])
        kind = n.get("kind", "proc")
        sub = n.get("sub")
        cy = y + NODE_H / 2 - (7 if sub else 0)
        parts.append('<g class="node k-%s" data-id="%s" tabindex="0" role="button">'
                     % (esc(kind), esc(n["id"])))
        parts.append('<rect x="%d" y="%d" width="%d" height="%d" rx="9" '
                     'fill="var(--dg-%s)" stroke="var(--dg-%s-s)" stroke-width="1"/>'
                     % (x, y, NODE_W, NODE_H, esc(kind), esc(kind)))
        parts.append('<text x="%d" y="%.1f" font-size="13" font-weight="500" '
                     'fill="var(--dg-%s-f)" text-anchor="middle" dominant-baseline="central">%s</text>'
                     % (x + NODE_W / 2, cy, esc(kind), esc(n["label"])))
        if sub:
            parts.append('<text x="%d" y="%.1f" font-size="10.5" fill="var(--dg-sub)" '
                         'text-anchor="middle" dominant-baseline="central">%s</text>'
                         % (x + NODE_W / 2, cy + 16, esc(sub)))
        parts.append('</g>')

    parts.append('</svg>')
    return "\n".join(parts)


def render_legend(d):
    nodes = d.get("nodes") or []
    used = [(k, l) for k, l in KINDS if any(n.get("kind", "proc") == k for n in nodes)]
    if not used:
        return ""
    items = "".join('<span class="lg"><i class="sw k-%s"></i>%s</span>' % (esc(k), esc(l))
                    for k, l in used)
    return '<div class="legend">%s</div>' % items


# ---------------------------------------------------------------- cards

def card(cid, title, body, ph, is_module, figure_html=""):
    anchor = ("mod-" if is_module else "blk-") + cid
    fig_block = ("\n  " + figure_html) if figure_html else ""
    return (
        '<section class="blk%s" id="%s">\n'
        '  <h2>%s</h2>\n%s'
        '  <div class="ai-body">\n%s\n  </div>\n'
        '  <div class="take-label">我的心得</div>\n'
        '  <div class="my-take" contenteditable="true" data-id="%s" data-ph="%s"></div>\n'
        '</section>' % (" mod" if is_module else "", esc(anchor), esc(title),
                        fig_block, body, esc(cid), esc(ph))
    )


def render_stage(diagram, svg):
    title = esc(diagram.get("title") or "方法管线")
    return ('<section class="stage">\n'
            '  <div class="stage-h">%s</div>\n'
            '  <div class="dg-wrap">%s</div>\n'
            '  %s\n'
            '  <div class="stage-tip">点击节点跳到对应详解</div>\n'
            '</section>') % (title, svg, render_legend(diagram))


def render_main(blocks, modules, stage_html, after, content_dir):
    out = []
    inserted = False
    for b in blocks:
        if not b.get("id") or not b.get("title"):
            raise BuildError("[build_note] block 必须同时有 id 和 title: %r" % b)
        fig_html = embed_figure(b.get("figure"), content_dir) if b.get("figure") else ""
        out.append(card(b["id"], b["title"], b.get("html", ""),
                        b.get("ph") or DEFAULT_TAKE_PLACEHOLDER, False, fig_html))
        if after and b["id"] == after:
            out.append(stage_html)
            out += module_cards(modules, content_dir)
            inserted = True

    if stage_html and not inserted:
        if after:
            print("[build_note] 警告: diagram.after='%s' 没匹配到任何 block，图已挪到正文末尾"
                  % after, file=sys.stderr)
        out.append(stage_html)
        out += module_cards(modules, content_dir)
    return "\n\n".join(out)


def module_cards(modules, content_dir):
    res = []
    for m in modules:
        if not m.get("id") or not m.get("title"):
            raise BuildError("[build_note] module 必须同时有 id 和 title: %r" % m)
        fig_html = embed_figure(m.get("figure"), content_dir) if m.get("figure") else ""
        res.append(card(m["id"], m["title"], m.get("html", ""),
                        m.get("ph") or DEFAULT_TAKE_PLACEHOLDER, True, fig_html))
    return res


def render_toc(blocks, modules, after):
    items = ['<a href="#blk-%s">%s</a>' % (esc(b["id"]), esc(b["title"])) for b in blocks
             if b.get("id") and b.get("title")]
    mods = ['<a href="#mod-%s">%s</a>' % (esc(m["id"]), esc(m["title"])) for m in modules]
    if not items and not mods:
        return ""
    if after and mods:
        pos = next((i + 1 for i, b in enumerate(blocks) if b.get("id") == after), len(items))
        items = items[:pos] + mods + items[pos:]
    else:
        items = mods + items
    return '<nav class="toc">%s</nav>' % "".join(items)


# ---------------------------------------------------------------- doc

def _validate_figure(fig, ctx):
    """校验 figure 字段格式。"""
    if not isinstance(fig, dict):
        raise BuildError("[build_note] %s.figure 必须是对象" % ctx)
    if not fig.get("src"):
        raise BuildError("[build_note] %s.figure 缺 src 字段" % ctx)
    ext = os.path.splitext(fig["src"])[1].lower()
    if ext and ext not in MIME_MAP:
        raise BuildError("[build_note] %s.figure 的图片格式不支持: %s（可选: %s）"
                         % (ctx, ext, ", ".join(sorted(MIME_MAP.keys()))))


def validate(data):
    """集中校验 content.json 的完整性和一致性。"""
    meta = data.get("meta") or {}
    diagram = data.get("diagram") or {}
    modules = data.get("modules") or []
    blocks = data.get("blocks") or []
    valid_kinds = {k for k, _ in KINDS}

    if not meta.get("title"):
        raise BuildError("[build_note] meta.title 不能为空")
    if not modules and not blocks:
        raise BuildError("[build_note] modules 与 blocks 不能同时为空")

    for i, b in enumerate(blocks):
        if not b.get("id") or not b.get("title"):
            raise BuildError("[build_note] blocks[%d] 必须同时有 id 和 title" % i)
        if b.get("figure"):
            _validate_figure(b["figure"], "blocks[%d]" % i)

    for i, m in enumerate(modules):
        if not m.get("id") or not m.get("title"):
            raise BuildError("[build_note] modules[%d] 必须同时有 id 和 title" % i)
        if m.get("figure"):
            _validate_figure(m["figure"], "modules[%d]" % i)

    nodes = diagram.get("nodes") or []
    if nodes:
        seen_ids = set()
        for i, n in enumerate(nodes):
            for f in ("id", "label", "col", "row"):
                if f not in n:
                    raise BuildError("[build_note] diagram.nodes[%d] 缺字段 %s" % (i, f))
            if not isinstance(n["col"], int) or n["col"] < 0:
                raise BuildError("[build_note] 节点 '%s' 的 col 必须是非负整数" % n["id"])
            if not isinstance(n["row"], int) or n["row"] < 0:
                raise BuildError("[build_note] 节点 '%s' 的 row 必须是非负整数" % n["id"])
            kind = n.get("kind", "proc")
            if kind not in valid_kinds:
                raise BuildError("[build_note] 节点 '%s' 的 kind '%s' 不合法，可选: %s"
                                 % (n["id"], kind, ", ".join(sorted(valid_kinds))))
            if n["id"] in seen_ids:
                raise BuildError("[build_note] 节点 id '%s' 重复" % n["id"])
            seen_ids.add(n["id"])

        by_id = {n["id"]: n for n in nodes}
        for i, e in enumerate(diagram.get("edges") or []):
            if e.get("from") not in by_id or e.get("to") not in by_id:
                raise BuildError("[build_note] edges[%d] 引用了不存在的节点" % i)

        node_ids = set(n["id"] for n in nodes)
        mod_ids = set(m["id"] for m in modules)
        for m in modules:
            if m["id"] not in node_ids:
                raise BuildError("[build_note] module id '%s' 在 diagram.nodes 里找不到对应节点" % m["id"])
        missing = node_ids - mod_ids
        if missing:
            print("[build_note] 警告: 这些图节点没有详解卡片, 点击会无反应: %s"
                  % ", ".join(sorted(missing)), file=sys.stderr)


def render(data, content_dir="."):
    validate(data)

    meta = data.get("meta") or {}
    diagram = data.get("diagram") or {}
    modules = data.get("modules") or []
    blocks = data.get("blocks") or []

    css = load_asset("note.css")
    js = load_asset("note.js")
    note_key = meta.get("arxiv") or slug(meta["title"])
    depth = meta.get("depth") or "精读"
    title_zh = '<p class="title-zh">%s</p>' % esc(meta["title_zh"]) if meta.get("title_zh") else ""

    svg = render_diagram(diagram)
    stage_html = render_stage(diagram, svg) if svg else ""
    after = diagram.get("after")

    body_cls = "with-dg" if svg else "no-dg"

    tpl = Template("""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body class="${body_cls}" data-theme="light" data-note-key="${key}">
<div class="wrap">
  <header>
    <div class="eyebrow">论文${depth}笔记</div>
    <h1 class="title">${title}</h1>
    ${title_zh}
    <div class="meta">
      ${meta}
    </div>
    ${tags}
    <div class="toolbar">
      <button class="btn" id="btn-html" type="button">导出 HTML</button>
      <button class="btn" id="btn-md" type="button">导出 Markdown</button>
      <button class="btn" id="btn-svg" type="button">导出图 SVG</button>
      <button class="btn" id="btn-png" type="button">导出图 PNG</button>
      <button class="btn" id="btn-print" type="button">打印 / 存 PDF</button>
      <button class="btn" id="btn-theme" type="button">暗色</button>
      <button class="btn danger" id="btn-clear" type="button">清空心得</button>
    </div>
  </header>

  <main class="main">
${toc}
${main}
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
${js}
</script>
</body>
</html>
""")
    doc = tpl.safe_substitute(
        title=esc(meta["title"]),
        title_zh=title_zh,
        meta=build_meta(meta),
        tags=build_tags(meta),
        toc=render_toc(blocks, modules, after if svg else None),
        main=render_main(blocks, modules, stage_html, after, content_dir),
        css=css,
        js=js,
        key=esc(note_key),
        depth=esc(depth),
        body_cls=body_cls,
    )
    return doc


def main():
    ap = argparse.ArgumentParser(description="生成可编辑的论文精读 HTML 笔记")
    ap.add_argument("--content", required=True, help="内容 JSON 路径")
    ap.add_argument("--out", required=True, help="输出 HTML 路径")
    args = ap.parse_args()

    try:
        if not os.path.exists(args.content):
            raise BuildError("[build_note] 找不到内容文件: %s" % args.content)

        with open(args.content, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                raise BuildError("[build_note] content.json 不是合法 JSON: %s" % e)

        content_dir = os.path.dirname(os.path.abspath(args.content))
        doc = render(data, content_dir)

        out_dir = os.path.dirname(os.path.abspath(args.out))
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        with open(args.out, "w", encoding="utf-8") as f:
            f.write(doc)

        print("[build_note] 已生成: %s (%d 字节, %d 个节点卡片, %d 个通用板块)"
              % (os.path.abspath(args.out), len(doc.encode("utf-8")),
                 len(data.get("modules") or []), len(data.get("blocks") or [])))
    except BuildError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
