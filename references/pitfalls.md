# 已知陷阱（改代码前先读）

这套交互里踩过的坑。改 `note.css` / `note.js` / `build_note.py` 之前扫一眼，别把修好的又改回去。每条都写了「怎么发现的」，因为发现方法本身也可复用。

## 1. 跳转不能只依赖平滑滚动

**现象**：点击图上节点，页面纹丝不动。

**根因**：跳转只写了 `scrollIntoView({ behavior: "smooth" })`。实测瞬时滚动有效（`y=3315`），但平滑滚动执行后 `y` 仍是 0。预览面板把页面嵌在 iframe 里、或系统开了「减少动效」，平滑滚动就会被吞掉。

**做法**：`jumpTo()` 三层——先试平滑滚动，450ms 后检查 `pageY` 是否真变了，没变就用绝对位置瞬时滚；若本窗口根本没有滚动条（滚动条在父页面），再通过 `window.frameElement` + `window.parent.scrollTo` 滚父窗口（同源才有效，跨域用 try/catch 吞掉）。`prefers-reduced-motion: reduce` 时直接走瞬时。

注意裸锚点链接（`#mod-xxx`）有同样的病，目录里的链接必须也走 `jumpTo`。

## 2. 判定「当前章节」不要用可见面积

**现象**：点了 A 模块，图上高亮的却是 B（下一个）。

**根因**：用 `IntersectionObserver` 的 `intersectionRatio` 取最大者来判定当前位置。内容短的卡片在观察区间里的占比会被下一个更长的卡片盖过去。注意：**滚动落点其实是对的**，错的是判定——别被现象误导，先测落点再测判定。

**做法**：改成标准 scrollspy——取「最后一个越过判定线（视口顶部 +100px）的卡片」，与卡片长短无关。触发方式也换成 `scroll` 事件 + rAF 节流，比 IO 跟手。点击后还要 `lockUntil = now + 1200ms`，锁定期内不让联动覆盖点击时的高亮。

## 3. 导出 SVG/PNG 前必须解析 CSS 变量，且要带上根元素

**现象**：导出的 SVG 打开是全灰的，PNG 也没颜色。

**根因**：SVG 里的颜色写成 `fill="var(--dg-io)"`，独立文件里没有 CSS 定义。而解析时用 `svg.querySelectorAll("*")` **不包含 svg 根元素本身**，根上的 `font-family="var(--font-sans)"` 会漏掉。

**做法**：`resolveVars()` 里把根元素一起放进遍历数组，把 `fill` / `stroke` / `font-family` 三个属性里的 `var(--x)` 全换成计算后的实色。

## 4. 描线动画要挂在一次性 class 上

**现象**：滚动时图上的边一直闪。

**根因**：动画写在 `.edge.on` 上，而滚动联动会不停 toggle 这个 class，动画就被反复触发。

**做法**：动画只在 `.dg.tracing .edge.on` 下生效，且仅在点击节点时加 `tracing`，1 秒后移除。滚动联动不播动画。

## 5. 同列上下行的两条边会完全重叠

**现象**：模块 A 挂了个辅助模块 B，A→B 和 B→A 两条箭头叠成一条，看不出是双向。

**根因**：横向布局里上下两条边的水平段长度为 0，垂直段共用同一条 x。

**做法**：`route()` 里对同列的上下行连线做 ±15px 左右错开（下去走左边，回来走右边）。

## 6. 验证交互别靠肉眼点

滚动和点击这类 bug 肉眼很难定位——「没跳」和「跳错了」长得差不多，但根因完全不同。

**做法**：用 headless 浏览器 + 注入探针。复制目标 HTML，追加一段脚本（用 `dispatchEvent` 模拟点击，延时后把 `window.scrollY`、目标的 `getBoundingClientRect().top`、当前高亮的节点 id 写进一个 div），再：

```bash
msedge --headless=new --disable-gpu --window-size=1280,900 \
  --virtual-time-budget=9000 --dump-dom "file:///path/to/probe.html" | grep RESULT
```

这套流程已经固化成 `scripts/smoke_test.py`，直接跑就行。判据是两条：**落点 top ≈ 24**（对准）、**高亮 id == 点击的 id**（没串位）。
