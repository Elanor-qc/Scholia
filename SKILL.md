---
name: scholia
description: 把一篇论文（本地 PDF 或 arXiv 链接）读透，产出一份可编辑的单文件 HTML 精读笔记——正文中段嵌一张横向方法管线图，点击图上节点跳到对应详解章节。当用户说「读论文」「精读这篇」「这篇论文帮我整理一下」「读下这个 arXiv」「论文笔记」「paper note」时使用。
agent_created: true
---

# scholia · 论文精读 → 可编辑 HTML 笔记

> scholia，古典文献页边的批注。正文由 AI 预填，页边那道空白永远留给你写。

## 产出目标

一份**单文件、自包含**的 HTML 笔记，正文顺序固定：

**一句话结论 → 要解决什么问题 → 方法管线图 → 图上各模块详解 → 实验与结果 → 消融 → 创新点 → 局限 → 可复刻性 → 与我研究的关联**

- 图是**横向**的（主干从左到右），嵌在「要解决什么问题」之后；宽度不够时容器内横向滚动，不压缩字号；
- 点击图上节点 → 滚到对应详解章节，同时该节点的**上下游整条链路**被点亮（其余淡出）；
- 滚动正文 → 图上自动高亮当前所在模块；
- 每个卡片下方一块「我的心得」可编辑区，浏览器里直接写，自动存 localStorage；
- 明暗双主题一键切换；导出 HTML / Markdown（含 mermaid）/ 图 SVG / 图 PNG / 打印。

分工原则：**内容归 AI，心得归用户**。AI 绝不预填心得区。

设计风格参考 archify 的几条内核（不是抄功能）：手工布局而非自动排版、聚焦与可达性高亮而非发明拓扑、动效有限且尊重 `prefers-reduced-motion`、单文件可移植。

## 工作流

### 第 1 步：拿到论文正文

**A. arXiv 链接或 ID**（`2501.12345`、`arxiv.org/abs/xxx`）

```bash
curl -s "http://export.arxiv.org/api/query?id_list=<ID>" -o <工作目录>/arxiv-meta.xml
curl -sL "https://arxiv.org/pdf/<ID>.pdf" -o "<工作目录>/paper.pdf"
```

**B. 本地 PDF**：直接用 agent 的文件读取能力打开（多数工具支持 PDF）。

省 token 策略：先读摘要页 + 方法章节 + 实验表格页 + 图表密集页，需要再补读。别一上来把 20 页全读进上下文。抓不到就报告问题，不许凭标题摘要硬编。

### 第 2 步：先画管线，再写详解

**这是本 skill 的灵魂步骤。** 读完先问自己：这篇论文的方法，能不能画成一条主干清晰的管线？

- 能 → 主干竖排在 `col: 0`，辅助模块（损失、密度控制、数据增强）挂到 `col: 1`。
- 不能（纯理论、纯评测类论文）→ 省略 `diagram`，笔记自动退化为单栏纯文字版，不丢功能。

画图的目的不是复述论文插图，而是**让没读过的人一眼看懂数据怎么流**。宁可节点少而清楚，不要节点多而完整。

### 第 3 步：写 content.json

只管内容不管排版。完整示例见 `assets/example-content.json`（3DGS 原论文）。

```json
{
  "meta": { "title": "必填", "title_zh": "", "authors": "", "affiliation": "",
            "venue": "", "arxiv": "", "url": "", "code": "", "date": "",
            "tags": [], "depth": "精读" },

  "diagram": {
    "title": "方法管线",
    "after": "problem",
    "nodes": [
      {"id":"gauss","label":"各向异性高斯","sub":"Σ = R S Sᵀ Rᵀ","kind":"latent","col":2,"row":0}
    ],
    "edges": [
      {"from":"init","to":"gauss","label":"初始化属性"}
    ]
  },

  "modules": [
    {"id":"gauss","title":"表示：各向异性高斯","html":"<p>...</p>","ph":"可选"}
  ],

  "blocks": [
    {"id":"limits","title":"局限与疑点","html":"<p>...</p>"}
  ]
}
```

**diagram 规范**

- `kind` 五选一：`io` 输入/输出、`proc` 处理、`latent` 表示/latent、`loss` 损失/监督、`aux` 辅助/可选
- **横向布局**：`col` 从左到右递增，`row` 从上到下递增。主干全部放 `row: 0`，辅助/损失模块下挂到 `row: 1`
- **手工指定位置**，脚本不做自动布局。同一列的上下行连线会自动左右错开，避免一来一回两条边重叠
- `after`：图插在哪个 block 之后（填 block id）。**固定写 `"after": "problem"`**，即图紧跟「要解决什么问题」；图后面自动接所有 modules
- `label` ≤ 8 字，`sub` ≤ 14 字（超出会撑破节点框）
- 节点总数 5–9 个为宜；`edges.label` ≤ 6 字
- **每个 node 都要有一个同 id 的 module**，脚本会报错拦截；反过来缺卡片只给警告

**modules 与 blocks 的分工**

- `modules`：图节点的详解，就是原来的「核心方法」拆开后的每一块。**紧跟图输出**，顺序按图上从左到右
- `blocks`：图装不下的通用板块。**顺序即正文顺序**，按下面这个写，别打乱：

  `tldr` 一句话结论 → `problem` 要解决什么问题 →（图 + modules 插在这里）→ `experiments` 实验与结果 → `ablation` 消融 → `contribution` 创新点 → `limits` 局限与疑点 → `reproduce` 可复刻性 → `relevance` 与我研究的关联

正文 `html` 允许的标签：`p / ul / ol / li / h3 / h4 / strong / em / code / pre / blockquote / table / hr`，以及 `<span class="flag ok|warn|risk">`。

写 JSON 时注意：字符串里不能有裸换行，长 HTML 写成单行。

### 第 4 步：构建 HTML

找到本 skill 目录下的 `scripts/build_note.py`，用任意 Python 3 执行：

```bash
python <skill目录>/scripts/build_note.py \
  --content "<工作目录>/content.json" \
  --out "<工作目录>/<论文简称>-精读笔记.html"
```

> **路径说明**：`<skill目录>` 是 `SKILL.md` 所在的目录（即 `build_note.py` 的父目录的父目录）。如果你不确定路径，先 `find` 或 `ls` 定位一下。

脚本会做：schema 校验（节点字段、边引用、module↔node 对应）、手写路由、CSS/JS 内联。报错信息带具体字段，照着改即可。

### 第 5 步：交互自检（改过 CSS / JS 之后必做）

改过 `note.css` / `note.js` / `build_note.py` 之后，跑一次冒烟，别靠肉眼点：

```bash
python <skill目录>/scripts/smoke_test.py "<刚生成的 html>"
```

它会逐个点击图上每个节点，检查两件事——落点是否对准（top≈24）、高亮有没有串到别的节点——逐条打印 PASS/FAIL。全绿再交付，有一行红就先修。

没改过代码的话这步可跳过，纯内容更新不影响交互。

### 第 6 步：交付

把生成的 HTML 文件交付给用户（直接打开、或用工具呈现均可）。口头总结三段：这篇最值得注意的一点、和用户研究方向的关系、哪些地方标注了不确定需要核对。

## 改代码前先读这个

`references/pitfalls.md` 记着这套交互已经踩过的坑：平滑滚动失效、当前章节判定错位、导出丢色、动画被滚动反复触发、同列上下两条边重叠。改 `note.css` / `note.js` / `build_note.py` 之前先看一眼，别把修好的又改回去。

## 写作红线

详见 `references/reading-framework.md`。最要紧三条：

1. **禁止编造**——没从原文读到的数字/结论，标注不确定或留空，不许填。
2. **禁止注水**——「本文具有重要意义」这类话一句都不许出现。
3. **禁止替用户写心得**——`.my-take` 永远留空。

## 用户背景（按需填写）

> 这一段留给用户自己写，或者在首次使用时通过对话收集。示例：
>
> 用户在做 **3dgsVAE**（3D Gaussian Splatting + VAE），关注表示的结构性、latent 空间的可编码性、压缩与生成，不是渲染速度。要求**大白话优先**：先讲清楚在干嘛，再上公式数字。

## 角色边界

agent 是用户的秘书，不是决策者。笔记里的判断可以写，但要标明是判断；遇到「值不值得复现」「要不要改方向」这类要用户拍板的问题，写进「与我研究的关联」的待议项，不替用户下结论。
