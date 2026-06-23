# 🎬 Story Engine · 故事引擎设计

> 🌐 [English Summary](#english-summary) · [中文全文](#中文全文)

---

<a id="english-summary"></a>

## 🇬🇧 English Summary

The story engine is **the core "magic"** of LiveWords — turning a vocabulary list into a 7-episode English mini-drama. This document explains *how* (without leaking prompt internals).

### Product contract: the 7-episode structure

```
Ep 1  →  Opening + cliffhanger (must use words[1])
Ep 2  →  Resolves Ep.1 hook + new action + cliffhanger
Ep 3  →  Build-up
Ep 4  →  🎲 Midweek branching choice — once chosen, locked forever
Ep 5  →  Proceeds along chosen branch
Ep 6  →  Approaches resolution, cliffhanger
Ep 7  →  🎬 Finale: climax + resolution + epilogue (no rushed endings)
```

### The single-episode generation pipeline

```
Input: words[N] + vibe + prior-episode digest + protagonist
   ↓
1. Build prompt (private template) with deterministic context injection
   ↓
2. Call LLM (Hunyuan default; DeepSeek as alternate)
   ↓
3. Parse & validate output (structured JSON: title, contentEn, contentMixed, state)
   ↓
4. Run validators:
   • All target words present?
   • Mixed paragraph token rules satisfied?
   • Word count in range?
   • Continuity signals intact?
   ↓
5. If any validator fails → run repair pass ONCE
   ↓
6. Persist to story_episode_drafts with full promptMeta (sha1, flags, mismatchReasons)
```

### Chinese-English mixed prose: strict token validation

The `paragraph.mixed` field must satisfy:
- ✅ Every target word must appear in English (even when embedded in Chinese phrases)
- ❌ No other English content words (no leaked English nouns, verbs, adjectives)
- ✅ Only a tiny allowlist of function words permitted
- ✅ English tokens must have whitespace boundaries

Validator is server-side — failure triggers automatic repair before marking the draft failed.

### Observability: `promptMeta`

Every generation persists a `promptMeta` record with:
- `systemPromptSha1` / `userPromptSha1` — prompt versioning (hashes, not contents)
- `flowOk`, `missingEpisodes`, `mismatchReasons` — quality signals
- `contextFlags.protagonistMode`, `contextFlags.branchSelected` — runtime context
- `attempts`, `repairApplied` — repair pipeline trace

This makes every failure debuggable end-to-end.

→ For evaluation methodology, read [`eval-methodology.md`](eval-methodology.md)
→ For runtime contracts, read [`architecture.md`](architecture.md)

---

<a id="中文全文"></a>

## 🇨🇳 中文全文

> LiveWords 最核心的"魔法"——把一个词表，变成 7 集英文连续剧。
>
> 这份文档讲**这个魔法是怎么做到的**（不含 prompt 原文，但讲清流程、契约与工程难题）。

---

## 1. 为什么要做"连续剧"模式

### 传统单词 APP 的问题

```
用户每天打开 APP → 看一堆卡片 → 关掉 → 第二天再来
```

**问题：** 学习行为没有"下钩"。卡片之间没有上下文，今天背的和明天背的是断裂的两件事。

### LiveWords 的解法

```
用户开 APP → 看到「第 3 集，悬念已经埋了 2 天了」 → 想知道结局 → 顺手把这组词也学了
```

**关键：** 把学习行为绑定到一个**有续集的故事**上。Cliffhanger 是钩子，单词是路径。

---

## 2. 7 集结构（产品契约）

```
┌─────┬────────────────────────────────────────────────────────┐
│ Ep  │  规则                                                  │
├─────┼────────────────────────────────────────────────────────┤
│  1  │  words[1] + vibe → 开场剧情，必须 cliffhanger          │
│  2  │  words[2] + vibe + Ep.1 上下文 → 解开 Ep.1 悬念 +      │
│     │  推进新动作，必须 cliffhanger                          │
│  3  │  ……                                                    │
│  4  │  🎲 中段分支选择（midweek choice）                     │
│     │  选项一旦提交，永久锁定                                │
│  5  │  按选定分支推进                                        │
│  6  │  接近收束，cliffhanger                                 │
│  7  │  🎬 Finale 大结局                                      │
│     │  必须：高潮对决 + 结局落地 + 余波/回扣                 │
│     │  禁止：几句话草草收尾                                  │
└─────┴────────────────────────────────────────────────────────┘
```

### 严格约束

- `vibe` 在同一轮 7 集内必须保持不变（防止"风格漂移"）
- 第 2~7 集必须**优先解决上一集结尾的悬念**，再推进新动作
- **禁止凭空冒出新人物/新地点/新"门口"** —— 任何新元素都要与当前场景有直接因果并交代清楚
- 每集必须**自然融入** target words（允许合理变形/派生/大小写/连字符）

---

## 3. 单集生成管线

```
ensureEpisodeDraft({ episodeIndex, operationId, ... })
                   ↓
       startOrResumeEpisodeDraft()
                   ↓
       [构造 prompt 上下文]
       • vibe (cycle 级别，不变)
       • history (Ep.1..N-1 累计故事)
       • targetWords (本集词表)
       • cefrLevel (非目标词难度上限)
       • protagonist (主角注入)
       • branchContext (如果已选过分支)
                   ↓
       [调用 LLM] → JSON 输出
       {
         "paragraph": {
           "english": "...",
           "mixed": "..."
         },
         "state": { ... }       ← 全中文剧情卡，下集 prompt 用
       }
                   ↓
       [Validator 系列校验]
       ✅ JSON 合法且单行
       ✅ 目标词全部命中（含变形）
       ✅ mixed 段不含非法英文 token
       ✅ english 字数在区间内
       ✅ state.value 不含英文字母
                   ↓
       [失败 → repair 一次]
                   ↓
       persist draft (status: ready / failed)
                   ↓
       commitEpisodeDraft (带 operationId + expectedRev)
                   ↓
       activeStory 更新，rev++，history 追加
```

---

## 4. 输入与输出契约

### 4.1 输入（User Prompt 结构）

发给 LLM 的 user message 是 JSON 字符串：

```json
{
  "episodeIndex": 3,
  "totalEpisodes": 7,
  "targetWords": ["word1", "word2"],
  "targetWordsMeta": [
    { "word": "word1", "pos": "n.", "translation": "中文释义" }
  ],
  "constraints": {
    "englishWordCount": { "min": 170, "max": 240 },
    "mixedEnglishPolicy": {
      "allowOtherEnglish": false,
      "allowedFunctionWords": ["a", "the", "and", "to"]
    }
  },
  "topic": "Deck Name",
  "focus": "Deck Focus",
  "cefrLevel": "A2",
  "instruction": "Write ONE coherent English scene that continues the story..."
}
```

### 4.2 输出（强制 JSON Only）

```json
{
  "paragraph": {
    "english": "Pure English scene, 2-4 paragraphs with dialogue...",
    "mixed": "中文叙事，目标词如 word1 保留英文 ..."
  },
  "state": {
    "key1": "全中文剧情卡 value"
  }
}
```

#### 强制规则

- 输出必须是**单行 JSON**（JSON 外不允许任何文字/解释/Markdown/代码块）
- JSON 引号必须使用 ASCII 双引号 `"`
- 字符串内的换行用 `\n` 表示
- `paragraph.english`：纯英文场景，建议 2-4 段 + 清晰对白
- `paragraph.mixed`：自然中文场景（**不是逐句翻译**），目标词保留英文（前后加空格）
- `state.value` 不允许出现英文字母

---

## 5. 中英混排（Mixed）的 Token 校验

这是 LiveWords 最具特色的**强工程约束**。

### 规则

`paragraph.mixed` 中**只允许**：

| 类别 | 是否允许 | 说明 |
|---|---|---|
| 目标词（含变形） | ✅ 必须出现 | `word1`、`words1`、`word-1` 都算命中 |
| 中文字符 | ✅ | 主要叙事用 |
| 极少量功能词（白名单） | ✅ | `a` / `the` / `and` / `to` 等，仅在表达必须时 |
| 其他英文实词 | ❌ | 自动判失败 |
| 英文专有名词 | ❌ | 必须翻译为中文 |
| 英文缩写 | ❌ | 同上 |

### 反常识：目标词不许翻译

> **即使目标词处在中文专有名词、物件名、引号里，也必须保留为英文目标词。**

例：

```
✅ 他打开 portfolio 看了一眼今天的收盘价。
❌ 他打开作品集看了一眼今天的收盘价。
```

### Repair 机制

校验失败时，后端会尝试 repair 一次（参考输入：失败原因 + 原始输出），仍失败则草稿标记 `failed`，前端可重试——**不会再用占位段落冒充成功**。

---

## 6. Prompt Skills 插拔机制

LiveWords 内置了一套**可插拔的写作技能**机制：

- NoSQL 集合 `story_prompt_skills` 存储一组写作技能文本
- 每条记录有 `enabled` 字段
- 生成 prompt 时，后端读取所有 `enabled=true` 的技能文本，**插入到 system prompt 中**
- 硬约束（cliffhanger / finale / 字数 / 词覆盖）优先级最高
- Skills 仅做**写作技法/风格/结构提醒**

**为什么这样设计：**
- 写作技能可以热更新，不用重新发版云函数
- 不同的 vibe 可以挂不同的技能组合
- 这是 LiveWords 内容质量调优的核心可观测面

---

## 7. 可观测性（promptMeta）

每集生成完毕后，后端把结构化信息写入 `story_episode_drafts.promptMeta`：

| 字段 | 用途 |
|---|---|
| `episodeIndexRequested` | 请求的集数 |
| `activeStoryCurrentEpisode` | 当时 activeStory 的当前集数 |
| `derivedEpisodeFromHistory` | 从 history 推断的集数 |
| `historyEpisodesUsed` | 实际用于 prompt 的历史集数 |
| `missingEpisodes` | 缺失集数列表 |
| `flowOk` | 流程一致性是否通过 |
| `mismatchReasons` | 不一致原因 |
| `systemPromptSha1` | system prompt SHA1（用于版本核对，不落库完整 prompt） |
| `userPromptSha1` | user prompt SHA1 |
| `model` / `modelProvider` | 实际生效的模型与 provider |
| `contextFlags.protagonistMode` | 主角模式是否激活 |
| `contextFlags.branchPlanned` | 分支选择是否生效 |
| `contextFlags.revivalActive` | 复活态是否激活 |

→ 这些字段让排查"为什么这一集生成得不好"成为**可追溯的工程问题**，而不是"AI 又抽风了"的玄学。

---

## 8. 模型选择

- Story Mode 读取 `users.settings.aiModel` 作为当集模型
- 默认 `hunyuan-2.0-instruct-20251111`
- 后端按模型自动匹配 provider：
  - `hunyuan-*` → `hunyuan-exp`
  - `deepseek-chat` → `deepseek`
- 实际生效模型记录在 `promptMeta.model` 与 `modelProvider`

---

## 9. 下一步阅读

- 📊 想了解**怎么衡量哪个 prompt 生成质量更好** → [`eval-methodology.md`](eval-methodology.md)
- 🏗️ 想了解**整体系统架构与契约** → [`architecture.md`](architecture.md)
- 📐 想了解**字段级契约规范** → [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md)
