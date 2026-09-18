# Scholia

把一篇论文读透，产出一份**可编辑的单文件 HTML 精读笔记**：正文中段嵌一张横向方法管线图，点图上任意节点跳到对应详解章节，每个章节下面留一块空白给你写心得。

> Scholia（σχόλια），古典文献页边的批注。正文由 AI 预填，页边那道空白永远留给你写。

`examples/3dgs-example-note.html` 是一份完整产出（读的是 3D Gaussian Splatting 原论文），下载下来直接用浏览器打开就能看效果，不用先装任何东西。

## 它长什么样

正文顺序是固定的，先讲清楚这是什么、为什么做，再讲怎么做，最后才是评价：

```
一句话结论 → 要解决什么问题 → 方法管线图 → 图上各模块详解
           → 实验与结果 → 消融 → 创新点 → 局限 → 可复刻性 → 与我研究的关联
```

- **方法管线图**是横向的，主干从左到右，损失和辅助模块下挂到第二排。节点位置由 agent 手工指定，不做自动排版
- 点击图上节点 → 跳到对应详解，同时该节点的**上下游整条链路**点亮、其余淡出，落点还会闪一圈光晕
- 滚动正文 → 图上自动高亮当前所在的模块
- 每张卡片下一块「我的心得」可编辑区，浏览器里直接写，自动存 localStorage
- 明暗双主题一键切换
- 导出：HTML / Markdown（含 mermaid 源码）/ 图 SVG / 图 PNG / 打印或存 PDF

## 安装

作为 WorkBuddy skill 使用，把整个目录放到 skill 目录下：

```bash
cp -r scholia ~/.workbuddy/skills/scholia
```

之后直接对 agent 说「读下这篇论文」并给出本地 PDF 路径或 arXiv 链接即可触发，不用点名。

依赖只有一个：**Python 3**（构建脚本用标准库，无第三方包）。

## 也可以单独当命令行工具用

不一定需要 agent，手写内容文件也能直接出笔记：

```bash
python scripts/build_note.py \
  --content assets/example-content.json \
  --out 我的笔记.html
```

改 `example-content.json` 里的内容就行，排版不用你管。

## 内容文件格式

`assets/example-content.json` 是一份完整示例，照着改即可。四块：

| 字段 | 作用 |
|---|---|
| `meta` | 标题、作者、会议、arXiv、代码链接、标签 |
| `diagram` | 方法管线图：`nodes`（含手工 `col`/`row`）+ `edges` + `after`（图插在哪个章节之后） |
| `modules` | 图上每个节点的详解，id 必须和 `nodes` 对得上 |
| `blocks` | 图装不下的通用板块，数组顺序就是正文顺序 |

`diagram` 的几个约定：

- `kind` 五选一：`io` 输入/输出、`proc` 处理、`latent` 表示、`loss` 损失/监督、`aux` 辅助
- 横向布局：`col` 从左到右递增，`row` 从上到下递增，主干放 `row: 0`
- `label` ≤ 8 字，`sub` ≤ 14 字，节点总数 5–9 个为宜
- `after` 推荐固定写 `"problem"`，即图紧跟「要解决什么问题」

正文 `html` 允许 `p / ul / ol / li / h3 / h4 / strong / em / code / pre / blockquote / table / hr`，外加 `<span class="flag ok|warn|risk">`。

## 写作红线

这三条规定是设计的一部分，不是客套话，详见 `references/reading-framework.md`：

1. **禁止编造**——没从原文读到的数字和结论，标注不确定或留空，不许填
2. **禁止注水**——「本文具有重要意义」这类话一句都不许出现
3. **禁止替用户写心得**——`.my-take` 区块永远留空，那是用户的位置

## 设计上的几点

- **图由 agent 手工布局，不用自动排版引擎**。自动布局在节点多了以后一定糊，而 agent 知道哪条是主干
- **高亮只用已经画出来的节点和边**，不发明拓扑，也不暗示运行时影响
- **动效有限**：只有点击时描一次线，且尊重 `prefers-reduced-motion`
- **单文件自包含**，CSS 和 JS 全内联，拷走就能用
- 风格上参考了 [archify](https://github.com/tt-a1i/archify) 的几条内核，功能不重合

## 调试技巧

改过交互之后别靠肉眼点验证，跑自带的冒烟测试：

```bash
python scripts/smoke_test.py 我的笔记.html
```

它会逐个点击图上每个节点，检查两件事——落点有没有对准、高亮有没有串到别的节点——逐条打印 PASS/FAIL，全绿才算过。会自动找本机的 Edge 或 Chrome，找不到用 `--browser` 指定；想手工排查加 `--keep` 保留探针文件。滚动相关的两个 bug 就是靠它两轮定位的。

原理是往页面注入探针脚本（模拟 `dispatchEvent` 点击，延时后把 `window.scrollY` 和目标 `getBoundingClientRect().top` 写进一个 div），再用 headless 浏览器 dump DOM 读回来。

已知陷阱另见 `references/pitfalls.md`。

## License

MIT，见 `LICENSE`。
