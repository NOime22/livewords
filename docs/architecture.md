# LiveWords · 架构总览

> 这份文档是 LiveWords 系统的**完整运行时契约说明**——既是工程团队的 source of truth，也是给外部读者的"看一眼就懂这个项目在做什么、用什么方式做"的全景图。

更详细的契约定义（字段级别）见 [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md)。

---

## 1. 系统范围

LiveWords 是一款**微信小程序**，核心是 Story Mode 学习循环：

```
   用户开 App
       ↓
   选词包 + vibe（主题氛围）
       ↓
   进入 7 集连续剧学习循环（每集背一组词 + 看一集剧情）
       ↓
   归档完成的 cycle，可在 storyArchive 回看
```

**三个层次：**

| 层次 | 实现 | 范围 |
|---|---|---|
| **前端** | 微信小程序（`miniprogram/`） | 7 页面 + 3 组件 + 一套本地缓存 + 同步队列 |
| **后端** | 腾讯云开发云函数（`cloudfunctions/`） | `userData` / `storyData` / `fetchStory` |
| **存储** | CloudBase NoSQL | 8 个集合（用户、词、故事、操作幂等记录） |
| **AI** | Hunyuan / DeepSeek | 章节生成 + 故事标题生成 |

---

## 2. 运行时契约

LiveWords 区别于"toy demo"的核心：**把 LLM 当作产线基础设施**，因此为它构建了一套契约系统。

### 2.1 幂等写入（`operationId`）

可重试的写入 API **必须**接受 `operationId`，并去重重放写入。

- `userData.upsertWordStatus` 支持 `operationId` 重放安全
- Story 写入路径（`commitEpisodeDraft`、分支选择、相关 mutation）使用**操作级去重 + 持久化 operation 记录**
- 重放成功的 mutation 返回去重指示，**不再执行第二次写入**

**为什么需要：** 弱网环境下，客户端经常重试。如果一集故事被生成两次，用户会困惑。

→ 实现细节见 `cloudfunctions/userData/index.js` 中的 `startUserOperation` / `finishUserOperation`。

### 2.2 乐观并发（`expectedRev` + `REV_CONFLICT`）

Story 进度写入是**版本号门控**的：

- `users.activeStory.rev` 单调递增，每次接受 mutation 时 +1
- 客户端在受保护的 mutation 路径上必须发送 `expectedRev`
- 版本号过期时，API 返回 `code: REV_CONFLICT`，**不修改任何状态**

**为什么需要：** 用户可能同时在两个微信设备上学习同一故事，必须保证状态不互相覆盖。

### 2.3 Retain-and-mark 过期 + bounded revival

过期是**非破坏性**的：

- 过期的故事保留在 `users.activeStory`，仅标记 `status: 'expired'`
- 过期元数据包括 `expiredAt`、`reviveEligibleUntil`、`reviveCount`
- 复活资格按 retain-and-mark 元数据计算
- 复活有上限：每个 cycle 仅允许复活一次（`reviveCount` 限制）

**为什么需要：** 用户可能忙了一周没学，故事到期了——直接删掉会让人失去回归动力。"还能救一次"反而是黏性钩子。

### 2.4 Protagonist Mode（主角模式）

故事 prompt 注入主角是**确定性**的：

- 源顺序：`cycle 存储的 protagonist → users.nickName → fallback`
- Prompt 元数据记录主角上下文供观测
- `story_episode_drafts.promptMeta.contextFlags.protagonistMode` 是运行时契约的一部分

**为什么需要：** 让用户成为剧的主角，体验是核心钩子。但 prompt 注入逻辑必须可观测，否则出问题不知道在哪一层。

### 2.5 中段分支不可变

第 N 集（配置）的分支选择是**确定性且选定后不可变**的：

- 分支边界持久化在 active cycle 元数据中
- 第一次有效选择持久化 `selectedBranch`
- 冲突的第二次提交被拒绝，返回 `code: BRANCH_IMMUTABLE`
- 分支上下文被传播到后续 prompt 元数据

**为什么需要：** 既是产品设计（让选择有重量），也是工程约束（避免分支状态在并发下错乱）。

### 2.6 Admin 门控的 eval 与 retry

非用户身份路径由**显式 admin 鉴权**守护：

- `devOpenid` 不是通用 OPENID fallback，**仅适用于 eval 白名单操作**
- `devOpenid` 需要 `ENABLE_DEV_OPENID=1` + HMAC `adminAuth` 验签
- `processDraftRetryQueue` 默认由定时器驱动，正常客户端调用返回 `code: FORBIDDEN_ACTION`，除非 admin 认证

**为什么需要：** 评估和重试是后台能力，不能被用户路径污染。

---

## 3. Story Mode 数据契约

### 3.1 `users.activeStory`

当前 live cycle 状态，存在用户文档上：

| 字段类别 | 字段 |
|---|---|
| **身份与进度** | `id`、`theme`、`status`、`currentEpisode`、`totalEpisodes`、`rev` |
| **历史** | 有序的 `history[]` 章节负载 |
| **生命周期控制** | `expiredAt`、`reviveEligibleUntil`、`reviveCount` |
| **Prompt 上下文** | protagonist 与 branch 元数据 |

### 3.2 `story_episode_drafts`

草稿生成与校验记录：

- **状态生命周期：** `generating | ready | failed`
- **生成内容：** `contentEn`、`contentMixed`
- **Prompt/过程元数据：** `promptMeta`，包含 `contextFlags` 与 flow 相关信号

### 3.3 `story_user_ops`

操作级幂等记录（用户/故事 mutation 重放安全）。

### 3.4 完整集合清单

```
users                    用户画像 + activeStory state（live cycle 唯一来源）
user_words               每个用户的单词掌握状态
dictionary               共享字典（CEFR 标注）
story_episode_drafts     章节生成草稿
story_draft_retry_queue  基于 lease 的重试队列，定时器驱动
story_user_ops           操作级幂等记录
story_archive            完成 cycle 归档
gen_logs                 生成可观测性日志
```

---

## 4. 验证命令（发布与回归契约）

以下命令是**发布合约的一部分**：

```bash
npm run verify              # 基线 lint + tests
npm run verify:rollout      # 灰度发布手册校验
npm run verify:regression   # 统一回归验证套件
npm run smoke:remote        # staging/prod 发布门禁
```

→ 完整测试指南见 [`guides/TESTING_GUIDE.md`](guides/TESTING_GUIDE.md)
→ 灰度发布手册见 [`guides/ROLLOUT_PLAYBOOK.md`](guides/ROLLOUT_PLAYBOOK.md)

---

## 5. 文档优先级（冲突解决顺序）

当不同文档说法冲突时，按以下顺序裁决：

1. `docs/CURRENT_ARCHITECTURE.md`（最权威）
2. `docs/guides/CONTENT_QUALITY.md`
3. `docs/guides/TESTING_GUIDE.md`
4. `docs/product/PRODUCT_BACKLOG.md`
5. `docs/README.md`

---

## 6. 下一步阅读

- 🎬 想了解**故事引擎怎么生成内容** → [`story-engine.md`](story-engine.md)
- 📊 想了解**怎么评估和调优 prompt** → [`eval-methodology.md`](eval-methodology.md)
- 🎨 想了解**UI/UX 设计哲学** → [`design.md`](design.md)
