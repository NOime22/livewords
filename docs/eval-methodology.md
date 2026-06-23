# 📊 Eval Methodology · 评估驱动调优

> 🌐 [English Summary](#english-summary) · [中文全文](#中文全文)

---

<a id="english-summary"></a>

## 🇬🇧 English Summary

> *"I tweaked the prompt and it feels better."* — that's not engineering, that's astrology.

LiveWords answers *"which prompt / which model / which parameters are better"* with a real measurement pipeline, not vibes.

### Core philosophy: Eval-Driven Development

LLM content products live with a structural tension:
- LLM outputs are stochastic — the same prompt produces different results
- Users need a stable quality floor — one bad episode loses retention
- Changing a prompt is easy — but each tweak introduces new failure modes

**Our answer**: treat every prompt change as a software change. Run the full eval suite before shipping.

### The evaluation pipeline (overview)

```
1. Maintain a golden test set (cases.json)
   covering different vibes, CEFR levels, wordpacks, edge cases
            ↓
2. Define Rubric v2 — multi-dimensional scoring
   (word coverage / continuity / cliffhanger strength / mixed-token compliance / …)
            ↓
3. For each case, run param-sweep — current prompt × N parameter sets × M generations
            ↓
4. Score each generation via evaluator (LLM-as-judge + rule-based validators)
            ↓
5. Aggregate, compare to baseline, decide ship/no-ship
```

### What's measured

| Signal | Why it matters |
|---|---|
| **Word coverage** | Did every target word appear naturally in the story? |
| **Continuity** | Did Episode N+1 actually pick up Episode N's threads? |
| **Cliffhanger strength** | Is the ending hooky or limp? |
| **Mixed-token compliance** | Does mixed prose obey the validator rules? |
| **State utility** | Does the state digest actually help next-episode generation? |
| **Word count** | Within the configured target range? |

### Observability: `promptMeta`

Each generation persists:
```js
{
  systemPromptSha1: "abc123...",  // prompt version (hash only)
  userPromptSha1: "def456...",
  flowOk: true,
  missingEpisodes: [],
  mismatchReasons: [],
  contextFlags: { protagonistMode: true, branchSelected: "A" },
  repairApplied: false,
  attempts: 1
}
```

This is the **single most valuable artifact** for debugging quality regressions — every shipped episode is causally traceable to its prompt version.

### Why the eval pipeline isn't open-sourced

The full `scripts/story-eval/` pipeline (rubric definitions, case curation, scoring chains, parameter strategies) **is LiveWords' core commercial asset**. We share the methodology and the observability schema, but not the playbook.

→ For runtime contracts, read [`architecture.md`](architecture.md)
→ For story engine details, read [`story-engine.md`](story-engine.md)

---

<a id="中文全文"></a>

## 🇨🇳 中文全文

> "我换了个 prompt，感觉好像好一点了。"
>
> ——这不是工程，这是占星。
>
> LiveWords 用一套真正可量化的评估流水线来回答"哪个 prompt / 哪个模型 / 哪个参数更好"。

---

## 1. 核心理念

### LLM 内容产品的本质矛盾

| 矛盾 | 后果 |
|---|---|
| LLM 输出是随机的 | 同样的 prompt 跑两次，结果不一样 |
| 业务需要稳定的质量下限 | 一次烂作就会让用户流失 |
| 改 prompt 看似简单 | 实际每改一处都可能引入新的失败模式 |

### LiveWords 的应对：Eval-Driven Development

> **不靠"试几次感觉一下"，而是把每一次 prompt 变更当作软件变更，跑完整评测套件再上线。**

这就是为什么 LiveWords 仓库里有一个完整的 `story-eval` 子系统——它是这个产品的**质量基础设施**。

---

## 2. 评估体系总览

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   1. 维护一套黄金测试集（cases.json）                            │
│      • 覆盖不同 vibe / cefr / 词包 / 边界场景                    │
│                                                                │
│                          ↓                                     │
│                                                                │
│   2. 定义 Rubric v2（多维度评分标准）                            │
│      • 词覆盖 / 连续性 / cliffhanger 力度 / 中英混排合规 / …      │
│                                                                │
│                          ↓                                     │
│                                                                │
│   3. 跑评估：对每个 case，按当前 prompt × 多组参数生成 N 次       │
│      • param-sweep：扫不同 temperature / top_p / 模型           │
│                                                                │
│                          ↓                                     │
│                                                                │
│   4. 每次生成喂给 evaluator 打分（LLM-as-a-judge 或规则校验）    │
│                                                                │
│                          ↓                                     │
│                                                                │
│   5. 聚合结果：每条 case 在每组参数下的平均分 + 分布             │
│                                                                │
│                          ↓                                     │
│                                                                │
│   6. 对比报告：旧 prompt vs 新 prompt 在所有维度上的得分变化     │
│                                                                │
│                          ↓                                     │
│                                                                │
│   7. 上线（如果显著改善）/ 回滚（如果回归）                      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Rubric v2（多维度评分）

LiveWords 的评分不是"单一分数"——而是**多维度独立评分**，每个维度可单独追踪。

### 主要维度

| 维度 | 衡量什么 | 失败案例 |
|---|---|---|
| **Word coverage** | 目标词是否全部自然出现 | 漏词、强行塞入显得突兀 |
| **Continuity** | 与前情是否连贯 | 凭空冒出新人物/地点、忘了上集悬念 |
| **Cliffhanger force** | 悬念是否真有钩子 | "他若有所思地走了" 这种伪悬念 |
| **Finale completeness** | Ep.7 是否真的收尾 | 几句话草草结束 |
| **Mixed token policy** | 中英混排合规 | 出现非目标英文实词 |
| **CEFR control** | 非目标英文是否在难度上限内 | 突然冒出 C2 词 |
| **Vibe consistency** | 风格是否漂移 | 第 1 集惊悚，第 3 集变温馨 |
| **Narrative pacing** | 节奏是否合理 | 信息倾倒、对白拖沓 |

### 评分来源

- ✅ **规则校验**：词覆盖、字数、JSON 合法性、token policy ← 100% 自动化
- 🧠 **LLM-as-a-judge**：连续性、悬念力度、节奏 ← 用更强的模型当裁判
- 👀 **人工抽检**：对 LLM judge 的标定，定期校准

---

## 4. Param-Sweep（参数扫描）

> "新模型上线了，要不要换？"
>
> 不是 A/B 拍脑袋——是 param-sweep 给数据。

### 实战场景

LiveWords 实际跑过的对比包括：

- `hunyuan-2.0-instruct-20251111` vs `hunyuan-turbos-latest` vs `deepseek-chat`
- 不同 temperature（`0.3` / `0.7` / `1.0`）下的稳定性 vs 创意性 trade-off
- 不同 system prompt 版本之间的回归差异

### 输出

每次 sweep 产出一份**对比报告**：

```
case_id    metric              v1_score   v2_score   delta
─────────────────────────────────────────────────────────
ch01_ep3   word_coverage         0.85       0.95     +0.10  ✅
ch01_ep3   cliffhanger_force     0.72       0.68     -0.04  ⚠️
ch01_ep3   continuity            0.90       0.92     +0.02  ✅
ch01_ep7   finale_completeness   0.60       0.85     +0.25  ✅
...
─────────────────────────────────────────────────────────
overall    weighted_avg          0.78       0.85     +0.07  ✅ SHIP
```

---

## 5. 可观测面：promptMeta

评估闭环的关键基础设施——**线上每一次生成都落库 `promptMeta`**：

```javascript
{
  systemPromptSha1: "abc123...",   // 哪个版本 prompt 生成的
  userPromptSha1: "def456...",
  model: "hunyuan-2.0-instruct-20251111",
  modelProvider: "hunyuan-exp",
  episodeIndexRequested: 3,
  historyEpisodesUsed: 2,
  missingEpisodes: [],
  flowOk: true,
  mismatchReasons: [],
  contextFlags: {
    protagonistMode: true,
    branchPlanned: false,
    revivalActive: false
  }
}
```

**为什么重要：**
- 出问题时，可以反向定位是哪个 prompt 版本生成的
- 可以**事后**对一段时间内的线上生成结果做质量分布分析
- A/B 灰度发版时，可以按 sha1 区分两组流量

---

## 6. 内置 Eval Workbench（前端）

LiveWords 在小程序内部置入了一个 **eval workbench**（开发者模式），供内部测试时使用：

- 切换不同的 chain（一组待测试的 prompt 配置）
- 单独触发某一集的生成
- 实时查看 `promptMeta` 输出
- 标记某次生成为"基线" / "回归" / "改进"

→ 这部分代码在 `miniprogram/utils/storyEvalChains.js` 和 `miniprogram/pages/index/modules/evalWorkbench.js`，**默认不对普通用户开放**。

---

## 7. 评估系统不在公开仓库里

> **完整的 eval pipeline（`scripts/story-eval/`）是 LiveWords 的核心商业资产之一，未在本仓库公开。**

这份文档讲清了**方法论**——但具体的：

- ❌ Rubric 的完整定义文档
- ❌ Evaluator prompt 模板
- ❌ 黄金测试集（cases.json）
- ❌ Param-sweep 自动化脚本

均不在公开仓库内。如需深度评估或合作，欢迎联系。

---

## 8. 我们学到的事

在做 LiveWords eval 系统的过程中，几个值得记录的工程经验：

### 8.1 "感觉好像好了一点" 是骗人的

大脑会自动 cherry-pick 好结果。**必须**有跨多个 case 的统计性证据。

### 8.2 LLM-as-a-judge 也会漂移

裁判模型本身在升级。需要定期对裁判模型的判分做人工校准。

### 8.3 失败模式比平均分更重要

平均分 0.85 不代表稳定——可能是 90% 的 0.95 + 10% 的 0.0。**看分布，不只看均值。**

### 8.4 Repair 链路是产品级稳定性的关键

一次 LLM 输出失败不应该让用户看到错误。LiveWords 的 `repair → fallback → mark failed` 三层链路，是把"60% 一次成功率"提升到"99% 用户感知成功率"的关键。

### 8.5 Prompt 版本号 + sha1 必须落库

线上"为什么这一集生成得不好"的排查，只能通过 `promptMeta` 反查。**没记，就没排查。**

---

## 9. 下一步阅读

- 🎬 想了解**故事引擎的生成管线** → [`story-engine.md`](story-engine.md)
- 🏗️ 想了解**整体系统架构** → [`architecture.md`](architecture.md)
- 📄 想了解**内容质量字段契约** → [`guides/CONTENT_QUALITY.md`](guides/CONTENT_QUALITY.md)
