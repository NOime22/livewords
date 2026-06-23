# LiveWords 功能测试指南

> ⚠️ 说明：本文包含较多“历史路径/行号/旧页面（如 session 页）/旧模型”描述，可能与当前实现不一致。  
> 当前权威口径与真实链路请以 `docs/CURRENT_ARCHITECTURE.md` 为准；测试用例可在此基础上再补全。

## 修复内容总结

### 1. ✅ AI 功能测试
**位置**: `miniprogram/pages/index/index.js` 第246-316行

**功能状态**: 已实现并正常工作
- 使用腾讯云混元AI模型 (`hunyuan-exp`)
- 流式生成单词和段落
- 有本地兜底数据（当AI不可用时）

**测试方法**:
1. 打开小程序首页
2. 点击中心的"换一组"按钮
3. 观察是否显示"生成中…"
4. 等待3-5秒，查看是否生成新的单词卡片
5. 检查控制台日志，查看是否有 `[AI] generate` 相关日志

**预期结果**:
- 如果AI可用：生成6个新单词，段落内容连贯
- 如果AI不可用：显示本地示例数据（abandon, access, benefit等）

---

### 2. ✅ 全英文段落加粗功能
**位置**: 
- `miniprogram/pages/index/index.js` 第1-19行（加粗函数）
- `miniprogram/utils/highlight.js`（段落高亮与 rich-text 转义/断词）

**修复内容**:
- ✅ 统一使用 `miniprogram/utils/highlight.js` 的 `highlightParagraph()` 生成 rich-text nodes
- ✅ 在主页 Session 面板中维护 `paragraphEnglishNodes` / `paragraphMixedNodes` 并渲染为 `<rich-text>`

**测试方法**:
1. 在首页完成所有单词学习（右滑所有卡片）
2. 看到"Done! 上滑查看 AI 段落"提示
3. 上滑进入段落详情页
4. 切换到"全英文"模式
5. 检查段落中的学习单词是否**加粗显示**

**预期结果**:
- 所有今日学习的单词在全英文段落中应该以**粗体**显示
- 例如：In today's world, we must not **abandon** our goals.

---

### 3. ✅ 双语穿插功能
**位置**: 
- `miniprogram/pages/index/index.js` 第68-74行（AI提示词）
- `miniprogram/pages/index/index.js` 第908-931行（本地示例数据）

**修复内容**:
- ✅ 优化了 `SYSTEM_PROMPT`，明确要求"中英文混合"格式
- ✅ 添加了具体示例："今天我们要 explore 一个 complex 的问题"
- ✅ 更新了本地兜底数据，提供标准的双语穿插示例

**测试方法**:
1. 在段落详情页切换到"双语穿插"模式
2. 检查段落内容是否是中英文混合
3. 确认关键英文单词是否保留原文

**预期结果**:
- **正确格式**: "在当今世界，我们不能 abandon 我们的目标。拥有 access 教育会带来很多 benefits。"
- **错误格式**: 全中文翻译或全英文段落

**本地示例数据**:
```
在当今世界，我们不能 abandon 我们的目标。拥有 access 教育会带来很多 benefits。
Complex 的问题不断 emerge，我们通过仔细分析 derive 解决方案。
我们 highlight 的每个 feature 都能 generate 积极的 impact，
这有助于 justify 我们的 key 决策。
```

---

## 完整测试流程

### 步骤1: 测试AI生成（首页）
1. 打开微信开发者工具
2. 编译并运行小程序
3. 点击中心"换一组"按钮
4. 等待生成完成
5. ✅ 检查是否生成了新单词

### 步骤2: 测试单词学习流程
1. 右滑卡片标记"认识"
2. 左滑卡片标记"再练练"
3. 完成所有单词学习
4. ✅ 检查进度环是否更新

### 步骤3: 测试段落详情页
1. 看到"Done! 上滑查看 AI 段落"
2. 上滑进入段落详情页
3. 切换到"全英文"模式
4. ✅ 检查学习单词是否加粗
5. 切换到"双语穿插"模式
6. ✅ 检查是否是中英文混合格式
7. 点击"复制段落"按钮
8. ✅ 检查是否成功复制

### 步骤4: 关于“Session独立页面”
当前实现中**没有单独的 Session 页面**，段落展示与模式切换均在主页的 Session 面板内完成。

---

## 调试技巧

### 查看AI生成日志
在控制台搜索：
```
[AI] generate
[AI] stream start
[AI] stream end
[AI] parse ok
```

### 查看段落节点数据
在控制台执行：
```javascript
const pages = getCurrentPages();
const currentPage = pages[pages.length - 1];
console.log('English:', currentPage.data.paragraphEnglishNodes);
console.log('Mixed:', currentPage.data.paragraphMixedNodes);
```

### 强制使用本地数据测试
在 `index.js` 第246行，临时修改：
```javascript
const aiAvailable = false; // 强制使用本地数据
```

---

## 已知问题

### 1. AI生成速度
- 首次生成可能需要5-10秒
- 网络不稳定时可能失败
- 失败后会自动切换到本地示例数据

### 2. 双语穿插质量
- AI生成的双语穿插质量取决于模型理解
- 如果生成的不是双语穿插，可以多试几次
- 本地示例数据提供了标准格式参考

### 3. 加粗匹配
- 使用正则表达式匹配单词边界
- 大小写不敏感
- 只匹配完整单词（不匹配词根）

---

## 成功标准

✅ **AI功能**: 能够生成新单词和段落，或显示本地示例数据  
✅ **加粗功能**: 全英文段落中的学习单词显示为粗体  
✅ **双语穿插**: 段落内容是中英文混合，关键单词保留英文  

---

## 联系支持

如果遇到问题，请检查：
1. 微信开发者工具版本是否最新
2. 云开发环境是否正确配置
3. 网络连接是否正常
4. 控制台是否有错误日志
