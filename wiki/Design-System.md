# 设计系统

GeekGeekRun 采用统一的**浅色主题**，基于 Element Plus 定制。所有渲染窗口与 `body` 弹出的浮层共用同一套语义色。

## 色彩规范

### 主色

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--el-color-primary` | `#1668dc` | 主色（按钮、链接、选中态） |
| `--ggr-primary-hover` | `#175cd3` | 主色悬浮态 |
| `--el-color-primary-dark-2` | `#154eaf` | 主色按下态 |

### 语义色

| 变量 | 值 | 含义 |
| --- | --- | --- |
| success | `#287a1d` | 成功 |
| warning | `#96620a` | 警告 |
| danger / error | `#b42318` | 危险、删除、覆盖 |
| info | `#667085` | 信息、次要文字 |

其中「危险 / 删除 / 覆盖」统一使用红色 `#b42318`，例如删除记录、覆盖数据的确认按钮。

### 文字色

| 变量 | 值 |
| --- | --- |
| primary | `#26373b` |
| regular | `#475467` |
| secondary | `#667085` |
| placeholder | `#6b7280` |
| disabled | `#98a2b3` |
| brand text | `#17665f`（品牌强调文字，青绿色） |

## 按钮状态

填充按钮的悬浮 / 按下态保持深色以保证白字可读：

- 主色：悬浮 `#175cd3`，按下 `#154eaf`；
- 成功 / 警告 / 危险 / 信息：悬浮与按下统一使用各自 `dark-2` 变体（如危险按下 `#912018`）。

`.ggr-danger-confirm` 为危险确认按钮类：红色背景白字，悬浮 / 按下更深，用于删除、覆盖等不可逆操作。

## 焦点与无障碍

- 键盘焦点：`focus-visible` 时显示 `2px` 主色描边，`outline-offset: 3px`；禁用按钮描边为禁用文字色；
- 强制颜色模式（`forced-colors: active`）下，焦点描边切换为系统 `Highlight` 色，保证高对比度环境可用。

## 侧边栏与「玻璃」效果

左侧导航面板在浅色主题下使用青绿色渐变背景 `#eaf4f1 → #dcf6f2`（品牌青绿系）。

窗口的**原生玻璃**（桌面半透明）与侧边栏外观是分离的两层：

- **macOS**：使用系统 vibrancy 半透明材质，并叠加自定义 SVG 滤镜实现**液态玻璃折射**；
- **Windows 11**：使用系统 acrylic 材质；
- **Windows 10**：无 Electron `backgroundMaterial`，改用应用内磨砂（frosted）玻璃；
- 关闭系统透明效果（`reduceTransparency`）或不支持 backdrop 时，退化为静态不透明面板。

### 液态玻璃折射（SVG feDisplacementMap）

macOS 侧边栏的折射通过 SVG 滤镜管线实现：`blur → 折射（feDisplacementMap）→ 色彩混合（饱和度 / 提亮）`。位移图把面板建模为带凸起圆角倒角的「玻璃板」：

- 面板中央平坦（无折射）；
- 越靠近边缘越陡，背景沿边缘法线向内拉伸——模拟真实玻璃边缘的透镜效果。

该位移图在运行时由 `glass.js` 的 `refractionMap(w, h, { radius, bezel, maxShift })` 生成，编码为 R = 水平位移、G = 垂直位移（128 = 无位移）。
