---
name: skin-studio
description: 制作 DSH 启动器皮肤与 dsh 本体前端皮肤的完整工艺:变量/token 清单、两套模板、背景图占位符用法,配合 skin_studio 工具一键落地。
whenToUse: 用户要求制作、修改或定制 DSH 启动器皮肤或 dsh 本体(前端)皮肤,而你需要变量清单和模板时。
---

# DSH 皮肤工坊工艺

先按 skin_studio 工具的系统提示走需求流程(目标/风格/主色/明暗/背景图),需求确认后再写 CSS 并调用工具。

## 启动器皮肤(target: launcher)

覆盖 `:root` 的 `--lc-*` 变量即可换肤,全部变量:

| 变量 | 作用 |
|---|---|
| `--lc-bg` | 页面底色 |
| `--lc-nav-bg` | 左侧导航底色 |
| `--lc-card-bg` | 卡片底色 |
| `--lc-btn-bg` / `--lc-input-bg` | 按钮 / 输入框底色 |
| `--lc-hover` / `--lc-active-bg` | 悬停 / 选中态 |
| `--lc-text` / `--lc-text-dim` / `--lc-title` | 正文 / 次要文字 / 标题 |
| `--lc-accent` / `--lc-accent-dim` / `--lc-accent-bg` | 主强调色及弱化/底色版 |
| `--lc-border` / `--lc-border-dim` | 边框 |
| `--lc-ok` / `--lc-warn` / `--lc-danger` / `--lc-danger-dim` | 状态色 |

模板(墨绿哑光示例):

```css
:root {
  --lc-bg: #101613; --lc-nav-bg: #0c110ecc; --lc-card-bg: #16201acc;
  --lc-btn-bg: #1b2620; --lc-input-bg: #0d1210;
  --lc-hover: #1e2a24; --lc-active-bg: #24332c;
  --lc-text: #d8e6dd; --lc-text-dim: #8fa89a; --lc-title: #eaf5ee;
  --lc-accent: #4fd08a; --lc-accent-dim: #2c7a52; --lc-accent-bg: #4fd08a22;
  --lc-border: #2a3a32; --lc-border-dim: #1d2a24;
  --lc-ok: #4fd08a; --lc-warn: #d9b44a; --lc-danger: #e2604f; --lc-danger-dim: #e2604f55;
}
/* 背景图(可选):body 直接铺图 */
body { background: url(__SKIN_BG__) center/cover fixed no-repeat; }
```

## 本体前端皮肤(target: frontend)

重映射 dsh 设计 token `--dsw-alias-*`。亮色写 `:root`,暗色写 `body[data-ds-dark-theme]`(dsh 应用内主题属性,勿用 prefers-color-scheme)。常用 token:

- 面板:`--dsw-alias-bg-base`(body 底,可带 alpha 让背景图透出)、`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-bg-overlay`
- 文字:`--dsw-alias-label-primary/secondary/tertiary`
- 边框:`--dsw-alias-border-l1/l2/l3/l4`
- 品牌:`--dsw-alias-brand-primary` 及 hover/active 变体

背景图按 skin-center 原版层级直接写 body(工具的自动追加规则就是这个形态):

```css
body { background-image: url(__SKIN_BG__); background-size: cover;
  background-position: center; background-attachment: fixed; background-repeat: no-repeat; }
[id="root"] { background: none; }
```

要点:给 `--dsw-alias-bg-base` 带 alpha(如 `#10161380`)背景图才能透出;暗色皮肤加 `color-scheme: dark`。

## 背景图三种来源

1. **用户提供本地图**:把绝对路径传给 `background_image_path`,CSS 里写 `url(__SKIN_BG__)`。
2. **你有图像生成工具**:先生成图片文件,再按 1 处理。
3. **都没有**:告知用户不能生图,建议纯色/渐变设计(CSS 渐变不需要图片)。

## 落地

调 `skin_studio {target, name, css, background_image_path?, apply?}`。启动器皮肤立即可见;本体皮肤要刷新 dsh 页面。之后用户可在启动器「皮肤」页切换/删除。
