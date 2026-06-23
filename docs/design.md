# 🎨 Design · UI/UX 设计

> 🌐 [English Summary](#english-summary) · [中文全文](#中文全文)

---

<a id="english-summary"></a>

## 🇬🇧 English Summary

> *"A learning app doesn't have to look like a learning app."*

LiveWords' visual identity is **the anti-"cyberpunk learning app"** — bright, airy, generous whitespace, premium feel. It reads more like a lifestyle product than a study tool.

Full spec: [`design/LIVEWORDS_UI_DESIGN.md`](design/LIVEWORDS_UI_DESIGN.md).

### Design goals

| Goal | What it means |
|---|---|
| **Bright & uplifting** | Light backgrounds, fresh accents, generous whitespace — no dark/neon/cyber aesthetic |
| **Minimal & calm** | Few elements per screen, clear hierarchy, no dense ornament |
| **Short learning path** | 1-2 taps to core on first-run, 1 tap on return |
| **Discoverable interactions** | Key actions are visible buttons; gestures are *enhancements*, not primary |
| **System consistency** | Shared components reused across pages (cards, chips, sliders, tabs) |
| **WeChat-native** | Only `view`, `text`, `image`, `button`, `scroll-view`, `swiper`, basic transitions |

### Visual language

**Backgrounds**
- `BG/Main`: very light warm gray / near-white (`#F6F7FB`)
- `BG/Card`: pure white (`#FFFFFF`)
- `BG/Overlay`: 92-96% opaque white over blurred background

**Primary palette**
- **`Primary`**: teal `#23C4C9` — main CTA, active state
- `Primary Soft`: pale teal `#E1F8F9` — subtle highlights

**Secondary palette**
- `Secondary`: sky blue `#4C8DFF` — secondary CTA, progress, links
- `Highlight`: soft coral `#FF7A6E` — emphasis, streak badges

**Neutrals**
- `Text/Primary`: deep slate `#1E2433`
- `Text/Secondary`: mid gray `#6E7484`
- `Border/Light`: `#E1E4EC`

**Semantic**
- `Success`: soft green `#37C985` · `Warning`: amber `#FFC857` · `Error`: red `#F45B5B`

### Core interactions

- **Card-based home** — story progress at a glance, no nested navigation
- **Story reader** — full-screen immersive, swipe between paragraphs
- **Word interactions** — long-press for definition; tap to mark as known
- **Settings panel** — one screen, no tabs, no nested menus

### Design principles

1. **Discoverable over clever** — visible buttons beat hidden gestures
2. **Calm over busy** — let breathing room do the design work
3. **System over one-offs** — shared components, no page-specific styles
4. **Performance is design** — slow == ugly

→ For runtime architecture, read [`architecture.md`](architecture.md)

---

<a id="中文全文"></a>

## 🇨🇳 中文全文

> "学习应用不一定要长得像学习应用。"
>
> LiveWords 在视觉上反"赛博朋克学习应用"路线，走的是**轻盈、明亮、留白、高级**——更接近一款生活方式 APP。

详细规范见 [`design/LIVEWORDS_UI_DESIGN.md`](design/LIVEWORDS_UI_DESIGN.md)。

---

## 1. 设计目标

| 目标 | 含义 |
|---|---|
| **明亮 & 上扬** | 浅色背景、清新强调色、大量留白；拒绝深色/霓虹/赛博风 |
| **极简 & 平静** | 每屏元素少、层级清晰、无密集装饰 |
| **学习路径极短** | 首次进入 1-2 tap 到核心、回访 1 tap |
| **可发现的交互** | 关键动作必须有可见按钮；手势仅作增强 |
| **一致的系统** | 跨页面复用组件（卡片、芯片、滑块、tabs） |
| **微信原生友好** | 仅使用 `view` / `text` / `image` / `button` / `scroll-view` / `swiper` / 基础动画 |

---

## 2. 视觉语言

### 2.1 色彩

#### 背景
- `BG/Main`：极浅暖灰或近白色（如 `#F6F7FB`）
- `BG/Card`：纯白（`#FFFFFF`）
- `BG/Overlay`：92-96% 不透明白色覆于模糊背景上

#### 主色
- **`Primary`**：青绿色 `#23C4C9` —— 主 CTA、激活态
- `Primary Soft`：浅青晕染 `#E1F8F9` —— 细微高亮

#### 副色
- `Secondary`：天蓝 `#4C8DFF` —— 次级 CTA、进度、链接
- `Highlight`：柔珊瑚 `#FF7A6E` —— 强调、连胜徽章

#### 中性
- `Text/Primary`：深 slate `#1E2433`
- `Text/Secondary`：中灰 `#6E7484`
- `Border/Light`：`#E1E4EC`

#### 语义
- `Success`：柔绿 `#37C985`
- `Warning`：琥珀 `#FFC857`
- `Error`：红 `#F45B5B`

### 2.2 排版

- **字体族**：现代无衬线（系统默认：SF Pro / PingFang / Roboto）
- **角色**
  - `H1`：24-28pt bold —— 页面标题
  - `H2`：20-22pt semi-bold —— 关键数值
  - `Body`：14-16pt regular —— 正文与标签
  - `Caption`：12-13pt regular —— 辅助文字、标签、元信息
- **行高**
  - 标题约 120%
  - 正文约 140-150%

### 2.3 形状与高度

- **卡片**：16-24rpx 圆角
- **按钮**：药丸状（完全圆角）
- **芯片**：完全圆角 + 微边框
- **阴影**
  - L0：扁平
  - L1：卡片阴影（柔和，~2-4dp）
  - L2：底部弹层等抬升表面（~6dp）

### 2.4 图标

- 简洁线形/双色图标，统一描边宽度
- 偶尔搭配轻量插画用于空态/加载态

---

## 3. 布局系统

- **网格**：单列移动端布局
- **内容宽度**：屏幕的 88-92%
- **横向 padding**：24-32rpx
- **竖向节奏**
  - 节区间距：24-32rpx
  - 组件内间距：8-16rpx
- **安全区**：尊重状态栏与小程序导航；自定义顶栏避开刘海

---

## 4. 核心交互

### 4.1 导航

```
Welcome → Main Home
Main Home → Word Session
Word Session → Session Completion → AI Paragraph
Main Home → Settings & Profile
```

- 子页面用默认返回箭头
- 全局入口：设置/资料始终可见于主页（头像或齿轮）

### 4.2 手势

- 单词卡水平滑动作为次要输入
- 可见按钮作为主要输入

---

## 5. 核心页面

| 页面 | 文件 | 作用 |
|---|---|---|
| **Welcome** | `miniprogram/pages/welcome/` | 首屏 + 微信登录 |
| **Index (Home)** | `miniprogram/pages/index/` | 学习主页 + 故事入口 |
| **Story Reader** | `miniprogram/components/story-reader/` | 章节阅读器组件 |
| **Mastered Words** | `miniprogram/pages/masteredWords/` | 已掌握词回顾 |
| **Story Archive** | `miniprogram/pages/storyArchive/` | 历史故事归档 |
| **Settings** | `miniprogram/pages/settings/` | 设置：每日新词数、词包、模型、复习模式 |

---

## 6. 设计原则

### 6.1 学习时不打扰

主学习路径上**不放任何非必要的元素**：

- 不要徽章弹窗
- 不要进度条以外的"催学习"提示
- 不要广告位

### 6.2 完成感优先

每个 session、每集故事完成时，**给清晰的完成态**——不是 modal 强制确认，而是页面状态自然过渡。

### 6.3 反 dopamine bait

LiveWords 不靠"连胜 X 天 / 推送提醒 / 红点"去刺激用户回归——靠**故事悬念**这个内在钩子。

---

## 7. 下一步阅读

- 📐 详细字段级规范 → [`design/LIVEWORDS_UI_DESIGN.md`](design/LIVEWORDS_UI_DESIGN.md)
- 📊 单词数量滑块 → [`design/WORD_COUNT_SLIDER.md`](design/WORD_COUNT_SLIDER.md)
- ⚙️ 设置页 → [`design/SETTINGS_PAGE.md`](design/SETTINGS_PAGE.md)
- 🏗️ 系统架构 → [`architecture.md`](architecture.md)
