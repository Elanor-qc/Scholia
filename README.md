# Scholia

把一篇论文读透，产出一份**可编辑的单文件 HTML 精读笔记**。

正文中段嵌一张横向方法管线图，点图上任意节点跳到对应详解章节，每个章节下面留一块空白给你写心得。

> Scholia（σχόλια），古典文献页边的批注。正文由 AI 预填，页边那道空白永远留给你写。

## 效果

`examples/3dgs-example-note.html` 是一份完整产出（读的是 3D Gaussian Splatting 原论文），下载下来直接用浏览器打开就能看效果，不用先装任何东西。

产出笔记的正文顺序固定：一句话结论 → 要解决什么问题 → 方法管线图 → 图上各模块详解 → 实验与结果 → 消融 → 创新点 → 局限 → 可复刻性 → 与我研究的关联。

主要交互：点击图上节点跳到对应详解并高亮上下游链路；滚动正文自动高亮当前模块；每个卡片下方可写心得（存 localStorage）；明暗主题切换；导出 HTML / Markdown / SVG / PNG / PDF。

## 安装

Scholia 是一份 agent-agnostic 的 **skill**——任何支持自定义指令的 AI 编程工具都能用。

核心就两件事：

1. **让 agent 能读到 `SKILL.md`**——这是给 AI 的工作指令
2. **让 agent 能执行 `scripts/build_note.py`**——这是构建笔记的 Python 脚本（仅依赖 Python 3 标准库）

各工具的常见放置方式：

| 工具 | 放置方式 |
|---|---|
| Claude Code | 项目根目录放 `SKILL.md`，或加入 `.claude/` 配置 |
| Qoder | 项目根目录放 `SKILL.md` |
| WorkBuddy | `cp -r scholia ~/.workbuddy/skills/scholia` |
| Codex | 按 Codex skill 约定放置 |

装好后直接对 agent 说「读下这篇论文」并给出本地 PDF 路径或 arXiv 链接即可，不用点名 skill。

## 命令行用法

不通过 agent、手写内容文件也能直接出笔记：

```bash
python scripts/build_note.py \
  --content assets/example-content.json \
  --out 我的笔记.html
```

改 `assets/example-content.json` 里的内容就行，排版不用管。内容文件格式的完整说明见该示例文件及 `SKILL.md`。

## License

MIT，见 `LICENSE`。
