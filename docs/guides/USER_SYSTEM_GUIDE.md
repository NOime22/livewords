# LiveWords 用户系统使用指南

> 总览与权威口径请优先阅读：`docs/CURRENT_ARCHITECTURE.md`

## 功能概览

LiveWords 现已集成完整的用户系统，支持：

- ✅ CloudBase 自动登录（基于 openid）
- ✅ 微信头像昵称可选授权同步
- ✅ 学习进度云端同步
- ✅ 智能避免重复单词
- ✅ 复习模式（专门复习已掌握的单词）
- ✅ 学习统计和数据分析
- ✅ 个性化设置（单词数、复习模式偏好）

## 部署步骤

### 1. 部署云函数

云函数 `userData` 已包含所有必要的功能，需要部署到云开发环境：

```bash
# 在微信开发者工具中：
# 1. 右键点击 cloudfunctions/userData 目录
# 2. 选择"上传并部署：云端安装依赖"
```

或使用命令行工具：

```bash
cd cloudfunctions/userData
npm install
# 然后通过微信开发者工具部署
```

### 2. 配置数据库权限

在云开发控制台设置数据库权限：

- `users` 集合：仅管理端可读写
- `user_words` 集合：仅管理端可读写
- `gen_logs` 集合：仅管理端可读写

### 3. 创建数据库索引（可选，提升性能）

在 `user_words` 集合中创建索引：

```javascript
// 索引1：userId + status（用于getReviewSet）
{
  "userId": 1,
  "status": 1
}

// 索引2：userId + word（用于快速查找单词）
{
  "userId": 1,
  "word": 1
}

// 索引3：userId + lastSeenAt（用于getAvoidList）
{
  "userId": 1,
  "lastSeenAt": -1
}
```

## 用户流程说明

### 首次使用流程

1. **自动登录**
   - 用户首次打开小程序
   - 小程序调用 `userData.ensureAuthSession`
   - 云函数通过 `cloud.getWXContext()` 获取 openid 并自动创建用户档案
   - 头像/昵称授权改为可选资料补全（`initProfile`）

2. **开始学习**
   - 授权成功后自动生成第一组单词
   - AI会避免生成用户已学过的单词（avoidList为空）

### 日常学习流程

1. **新学模式（默认）**
   - 点击进度环或"换一组"生成新单词
   - AI查询用户的避免列表（已掌握 + 近7天见过的单词）
   - 生成不重复的新单词
   - 滑动卡片学习

2. **单词状态同步**
   - 右滑（认识）→ 状态设为 `known`，计数器 +1
   - 左滑（不认识）→ 状态设为 `unknown`，重新加入队列
   - 实时同步到云端 `user_words` 集合

3. **复习模式**
   - 当已掌握单词 ≥ 10 个时，显示智能提示
   - 点击右上角模式切换按钮，或点击提示切换
   - 复习模式会从已掌握的单词中选取生成复习内容
   - 复习时也可以标记"忘记了"（降级为 unknown）

### 设置页功能

1. **用户信息展示**
   - 头像、昵称
   - 快速统计：已掌握数、总学习数

2. **学习统计**
   - 已掌握单词数
   - 待复习单词数
   - 总学习单词数
   - 累计学习天数

3. **学习设置**
   - 每日单词数：10-100 个（可调节，云端会做范围校验）
   - 默认复习模式：开启后启动时自动进入复习模式

4. **词库选择**
   - 雅思、托福、商务、旅行等多种词库

## 数据结构说明

### users 集合

```javascript
{
  _id: "openid",
  nickName: "用户昵称",
  avatarUrl: "头像URL",
  settings: {
    reviewModeDefault: false,  // 默认复习模式
    dailyNewCount: 10          // 每日单词数（10-100）
  },
  counters: {
    known: 0,        // 已掌握单词数
    unknown: 0,      // 待复习单词数
    totalLearned: 0, // 总学习单词数
    streak: 0,       // 当前连胜天数
    longestStreak: 0 // 历史最长连胜
  },
  lastStudyDate: "2025-12-08", // 最近一次学习日期（yyyy-MM-dd）
  createdAt: Date,
  updatedAt: Date
}
```

### user_words 集合

```javascript
{
  userId: "openid",
  word: "单词",
  lang: "en",
  pos: "词性",
  definition: "释义",
  topic: "词库ID",
  status: "known|unknown|learning|banned",
  familiarity: 0,      // 熟悉度
  exposures: 0,        // 曝光次数
  correctRate: 0,      // 正确率
  firstSeenAt: Date,
  lastSeenAt: Date,
  nextReviewAt: Date   // 下次复习时间（预留）
}
```

### gen_logs 集合

```javascript
{
  userId: "openid",
  mode: "new|review",
  requestedAt: Date,
  model: "deepseek-chat",
  deckId: "词库ID",
  targetCount: 6,
  topic: "词库名称",
  totalWords: 6,
  generatedWords: ["单词1", "单词2"],
  filteredOut: [],         // 过滤掉的单词
  avoidWordsSize: 50,      // 避免列表大小
  reviewWordsSize: 0,      // 复习词库大小
  promptChars: 1500,       // Prompt字符数
  durationMs: 3000,        // 生成耗时
  eof: true
}
```

## AI Prompt 增强说明

### 新学模式 Prompt

```javascript
const userContext = {
  mode: "new",
  avoidWords: ["word1", "word2", ...],  // 最多500个
  instruction: "请严格避免生成以下单词（用户已学过或近期见过）"
};

// AI会收到JSON格式的避免列表
```

### 复习模式 Prompt

```javascript
const reviewContext = {
  mode: "review",
  reviewWords: [
    {word: "analyze", pos: "v.", definition: "分析", topic: "ielts"},
    ...
  ],
  instruction: "请使用以下已掌握的单词生成复习内容，帮助用户巩固记忆"
};

// AI会基于这些单词生成复习材料
```

## 性能优化

1. **用户档案缓存**
   - `app.globalData.userProfile` 缓存用户信息
   - 减少云函数调用次数

2. **避免列表限制**
   - 最多500个单词，控制 prompt 长度
   - 优先近期单词，7天内见过的 + 已掌握的

3. **复习集合限制**
   - 最多20个单词，单次复习量适中
   - 按 lastSeenAt 排序，最久未见的优先

4. **异步同步**
   - 单词状态同步不阻塞UI
   - 使用 `.catch()` 处理错误，不影响用户体验

## 测试检查清单

- [ ] 首次启动显示授权引导
- [ ] 授权成功后自动生成第一组单词
- [ ] 右滑单词后计数器正确增加
- [ ] 左滑单词后重新加入队列
- [ ] 已掌握10个单词后显示复习提示
- [ ] 切换到复习模式生成已掌握的单词
- [ ] 设置页正确显示用户信息和统计
- [ ] 修改单词数后保存到云端
- [ ] 复习模式偏好正确保存

## 故障排查

### 授权失败
- 检查小程序appid配置
- 确保云开发已初始化
- 查看控制台错误信息

### 单词状态不同步
- 检查云函数是否正确部署
- 查看云函数日志
- 确认数据库权限设置正确

### 复习模式无单词
- 确认用户已掌握至少一个单词
- 检查 `getReviewSet` 云函数返回值
- 查看云函数日志中的 reviewWords 数量

## 未来扩展方向

1. **间隔重复算法（SRS）**
   - 实现 SM-2 算法
   - 根据 `nextReviewAt` 智能提醒复习

2. **学习报告**
   - 每日/每周/每月学习报告
   - 词汇量增长曲线

3. **社交功能**
   - 好友PK
   - 学习打卡分享

4. **更多数据维度**
   - 单词熟悉度评分
   - 遗忘曲线追踪
   - 学习时长统计

## 维护注意事项

1. **数据库清理**
   - 定期清理过期的 `gen_logs`（建议保留30天）
   - 备份用户数据

2. **性能监控**
   - 监控云函数调用量和耗时
   - 优化慢查询

3. **版本升级**
   - 兼容旧版本数据结构
   - 提供数据迁移脚本

---

**版本**: 1.0.0  
**更新时间**: 2025-01-13  
**作者**: LiveWords Team
