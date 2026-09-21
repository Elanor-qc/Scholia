#!/usr/bin/env python3
"""对生成的笔记做交互冒烟：逐个点击图上节点，检查落点是否对准、高亮是否串位。

原理：复制目标 HTML 并注入探针脚本（dispatchEvent 模拟点击，延时后读取
window.scrollY、目标 getBoundingClientRect().top、当前高亮的节点 id），
再用 headless 浏览器 --dump-dom 把结果读回来。

用法:
    python smoke_test.py 笔记.html
    python smoke_test.py 笔记.html --browser "C:/path/to/msedge.exe"
    python smoke_test.py 笔记.html --keep        # 保留探针文件便于人工排查

退出码: 0 全通过 / 1 有失败 / 2 环境问题
"""

import argparse
import os
import re
import shutil
import subprocess
import sys

CANDIDATE_BROWSERS = [
    # Windows
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    # macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    # Linux
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge",
]

PROBE = """
<script>
(function () {
  var out = [];
  var nodes = Array.prototype.slice.call(document.querySelectorAll(".node"));
  var ids = nodes.map(function (n) { return n.getAttribute("data-id"); });
  var i = 0;
  function activeId() {
    var n = document.querySelector(".node.active");
    return n ? n.getAttribute("data-id") : "NONE";
  }
  function finish() {
    var d = document.createElement("div");
    d.id = "smokeprobe";
    d.textContent = "SMOKE " + out.join(" ;; ");
    document.body.appendChild(d);
  }
  function step() {
    if (i >= ids.length) { finish(); return; }
    var id = ids[i++];
    window.scrollTo(0, 0);
    var node = document.querySelector('.node[data-id="' + id + '"]');
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    setTimeout(function () {
      var t = document.getElementById("mod-" + id);
      var top = t ? Math.round(t.getBoundingClientRect().top) : -9999;
      var locked = activeId();
      setTimeout(function () {
        out.push(id + "|" + top + "|" + locked + "|" + activeId());
        step();
      }, 1000);
    }, 1400);
  }
  window.addEventListener("load", function () { setTimeout(step, 300); });
})();
</script>
"""


def find_browser(explicit=None):
    if explicit:
        if not os.path.exists(explicit):
            sys.exit("[smoke] 指定的浏览器不存在: %s" % explicit)
        return explicit
    for p in CANDIDATE_BROWSERS:
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium-browser",
                 "chromium", "microsoft-edge-stable", "microsoft-edge", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit("[smoke] 没找到 Edge 或 Chrome，用 --browser 指定路径")


def main():
    ap = argparse.ArgumentParser(description="论文笔记交互冒烟测试")
    ap.add_argument("html", help="要测试的笔记 HTML 路径")
    ap.add_argument("--browser", help="浏览器可执行文件路径")
    ap.add_argument("--keep", action="store_true", help="保留探针文件")
    args = ap.parse_args()

    html = os.path.abspath(args.html)
    if not os.path.exists(html):
        sys.exit("[smoke] 找不到文件: %s" % html)

    browser = find_browser(args.browser)
    probe_path = os.path.join(os.path.dirname(html), "_smoke-probe.html")

    with open(html, "r", encoding="utf-8") as f:
        src = f.read()
    with open(probe_path, "w", encoding="utf-8") as f:
        f.write(src.replace("</body>", PROBE + "</body>"))

    url = "file:///" + probe_path.replace("\\", "/")
    budget = 30000
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--window-size=1280,900", "--virtual-time-budget=%d" % budget,
           "--dump-dom", url]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=180)
        dom = proc.stdout or ""
    except subprocess.TimeoutExpired:
        sys.exit("[smoke] 浏览器超时")

    # 必须精确匹配结果 div：dump-dom 会把注入的探针脚本源码一起输出，
    # 只搜 "SMOKE" 会抓到脚本自身而不是结果
    hits = re.findall(r'<div id="smokeprobe">SMOKE\s*([^<]*)</div>', dom)
    if not hits:
        if not args.keep and os.path.exists(probe_path):
            os.remove(probe_path)
        sys.exit("[smoke] 没拿到探针输出，页面可能报了 JS 错误")

    payload = hits[0].strip()
    if not payload:
        print("[smoke] 这份笔记没有流程图，跳过交互检查")
        if not args.keep and os.path.exists(probe_path):
            os.remove(probe_path)
        return 0

    rows = []
    for item in payload.split(" ;; "):
        parts = item.split("|")
        if len(parts) != 4:
            continue
        nid, top, locked, unlocked = parts[0], parts[1], parts[2], parts[3]
        try:
            top_v = int(top)
        except ValueError:
            top_v = -9999
        ok_top = abs(top_v - 24) <= 36
        ok_locked = locked == nid
        ok_unlocked = unlocked == nid
        rows.append((nid, top_v, locked, unlocked, ok_top and ok_locked and ok_unlocked))

    if not rows:
        sys.exit("[smoke] 探针输出解析不出结果: %s" % payload)

    w = max(len(r[0]) for r in rows) + 2
    print("")
    print("%-*s %-8s %-14s %-14s %s" % (w, "节点", "落点", "高亮(锁定期)", "高亮(解锁后)", "判定"))
    print("-" * (w + 52))
    for nid, top_v, locked, unlocked, ok in rows:
        print("%-*s %-8s %-14s %-14s %s" % (w, nid, top_v, locked, unlocked, "PASS" if ok else "FAIL"))
    print("")

    failed = [r[0] for r in rows if not r[4]]
    if failed:
        print("[smoke] 失败节点: %s" % ", ".join(failed))
        print("[smoke] 判据: 落点 top≈24，两处高亮都等于被点的节点")
        if not args.keep and os.path.exists(probe_path):
            os.remove(probe_path)
        return 1

    print("[smoke] %d 个节点全部通过" % len(rows))
    if not args.keep and os.path.exists(probe_path):
        os.remove(probe_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
