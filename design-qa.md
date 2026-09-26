# 首页默认布局视觉验收

## 对比目标

- source visual truth: `/var/folders/tv/z3w2qt314g1d7grfhq0w2jnc0000gn/T/codex-clipboard-1ecc701d-b4ca-4a4c-b8ab-a8eb78ffcb9a.png`
- implementation screenshot: `/private/tmp/to-do-panel-home-qa.png`
- state: TO-DO Panel 展开、首页选中、已有 7 条常用提示词与随笔记内容、默认主题
- viewport: 实际 macOS Electron 窗口；实现截图为 3456×2234 屏幕捕获，面板内容约 2360×1130 CSS 像素；源图为 2510×1110，按内容区域比较，不将桌面/浏览器背景计入
- density normalization: 以卡片相对位置和比例比较，忽略系统显示缩放与动态 Codex 用量数字

## Full-view comparison evidence

实现与源图的主要结构一致：

1. 左列为纵向常用指令卡片，包含标题输入、Obsidian 按钮、提示词输入和列表。
2. 中上为 Codex 用量，右上为随笔记。
3. 中下为人物镜子图，右下为 05:00 番茄钟。
4. 卡片间距、圆角、浅蓝玻璃背景和整体三列层级保持现有产品视觉系统。

动态内容差异（Codex 百分比、重置时间、随笔记文本）属于运行时数据，不是布局漂移。

## Focused-region comparison evidence

- 左列：常用指令纵向高度与列表密度符合源图。
- 中上/右上：用量与随笔记各占半高卡片，顶部对齐。
- 中下/右下：镜子与番茄钟各占半高卡片，底部对齐。
- 无需额外局部修复；主要布局关系在全视图中清晰可读。

## Required fidelity surfaces

- Fonts/typography: 沿用现有中文系统字体、标题/正文层级和截断规则；未引入新字体漂移。
- Spacing/layout rhythm: 新默认 12×4 Bento 网格由 `commands` 4×4 加四个 4×2 卡片组成，无空洞、无重叠。
- Colors/tokens: 沿用既有浅蓝玻璃面板、边框和阴影 token。
- Image quality: 镜子继续使用仓库内 `assets/mirror-portrait.jpg`，实际窗口中清晰显示。
- Copy/content: 常用指令、Codex 用量、随笔记、番茄钟文案与源图语义一致。

## Comparison history

- Initial implementation: 代码默认仍为旧的八模块布局，存在新用户首屏与源图不一致的问题。
- Fix: 将新安装默认顺序改为 `commands → usage → note → mirror → pomodoro`，默认隐藏音乐/窗口/录音，并为常用指令与番茄钟设置中等/大卡片尺寸；已有本地布局键继续优先。
- Post-fix evidence: `/private/tmp/to-do-panel-home-qa.png`；实际重启后的窗口显示目标五块布局，且随笔记保存后仍保留。

## Findings

无 P0/P1/P2 布局问题。现有动态数据差异为预期行为。

## Follow-up polish

- P3：若后续需要，可以为“恢复全部组件”增加一键恢复默认按钮；本次不改变用户已经保存的布局。

## Final result

passed

## 日报/周报合并验收

- 主版本首页顶栏出现“日报周报”入口，菜单包含“日报”和“周报”。
- 日报页可从主窗口打开，日期、原始记录、正文预览、Obsidian 路径和历史版本均可见。
- 周报切换可用，并能读取本周日报工作项；返回首页后主面板恢复正常渲染和展开状态。
- 报告存储使用独立的 `日报周报/日报` 与 `日报周报/周报` 路径，保存前校验版本，外部改动不会静默覆盖。
- 已安装并验收合并后的 `/Applications/TO-DO Panel.app`；旧 `/Applications/TO-DO Panel 日报版.app` 已移入废纸篓，`Dynamic Panel Reports` 数据目录保留。

## Report result

passed
