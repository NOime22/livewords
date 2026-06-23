# 本地兜底数据测试说明

> ⚠️ 说明：本文是历史测试记录，当前实现可能已不再包含“本地兜底/强制 mock”等同名逻辑或相同行号。  
> 若要了解当前测试模式、Session 生成与 AI 行为，请以 `docs/CURRENT_ARCHITECTURE.md` 为准。

## ✅ 已完成的修改

### 1. 强制使用本地数据
**位置**: `miniprogram/pages/index/index.js` 第230行

```javascript
// Force local mock data for testing
const aiAvailable = false; // 已禁用AI，强制使用本地数据
```

**效果**: 
- 点击"换一组"会立即使用本地示例数据
- 不会调用混元AI模型
- 生成速度非常快（无网络延迟）

---

### 2. 修复双语穿插显示问题
**问题原因**: 
- `buildHighlightedParagraph` 函数在 `highlight: false` 时逻辑有误
- 导致双语穿插模式返回空数组而不是段落文本

**修复内容**:
- ✅ 修改了 `index/index.js` 第1-26行
- ✅ 修改了 `session/index.js` 第1-26行
- ✅ 优化了函数逻辑，确保双语穿插正确返回

**新逻辑**:
```javascript
// highlight: false → 返回原始段落（用于双语穿插）
// highlight: true → 返回加粗后的段落（用于全英文）
```

---

### 3. 本地示例数据内容

#### 单词列表（6个）
1. **abandon** - 放弃
2. **access** - 访问
3. **benefit** - 益处
4. **complex** - 复杂的
5. **derive** - 获得
6. **emerge** - 出现

#### 全英文段落
```
In today's world, we must not abandon our goals. Having access to education 
brings many benefits. Complex problems emerge constantly, and we derive 
solutions through careful analysis. Each feature we highlight can generate 
positive impact, which helps justify our key decisions.
```

#### 双语穿插段落（重点！）
```
在当今世界，我们不能 abandon 我们的目标。拥有 access 教育会带来很多 benefits。
Complex 的问题不断 emerge，我们通过仔细分析 derive 解决方案。
我们 highlight 的每个 feature 都能 generate 积极的 impact，
这有助于 justify 我们的 key 决策。
```

**特点**:
- ✅ 中文句子结构
- ✅ 保留英文单词不翻译
- ✅ 自然的中英混合表达

---

## 🧪 测试步骤

### 步骤1: 编译运行
1. 打开微信开发者工具
2. 点击"编译"按钮
3. 等待编译完成

### 步骤2: 生成本地数据
1. 点击中心的"换一组"按钮
2. **应该立即显示**（不会有"生成中…"延迟）
3. 看到6个单词卡片：abandon, access, benefit, complex, derive, emerge

### 步骤3: 完成学习流程
1. 右滑所有6个卡片（标记为"认识"）
2. 看到"Done! 上滑查看 AI 段落"提示
3. 上滑进入段落详情页

### 步骤4: 测试全英文模式
1. 确保选中"全英文"标签（默认）
2. **检查**: 单词是否加粗显示
   - ✅ 正确: In today's world, we must not **abandon** our goals.
   - ❌ 错误: 单词没有加粗

### 步骤5: 测试双语穿插模式 ⭐
1. 点击"双语穿插"标签
2. **检查**: 是否显示中英混合段落
   - ✅ 正确: 在当今世界，我们不能 abandon 我们的目标。
   - ❌ 错误: 显示纯中文或纯英文

### 步骤6: 测试复制功能
1. 点击"复制段落"按钮
2. 检查是否提示"已复制"
3. 粘贴到其他地方验证内容

---

## 🎯 预期结果

### ✅ 成功标准

#### 1. 本地数据加载
- [ ] 点击"换一组"立即显示数据（无延迟）
- [ ] 显示6个固定单词
- [ ] 控制台无错误信息

#### 2. 全英文段落
- [ ] 单词显示为粗体
- [ ] 段落完整可读
- [ ] 可以正常复制

#### 3. 双语穿插段落 ⭐⭐⭐
- [ ] 显示中英混合文本
- [ ] 英文单词保留原文（如 abandon, access）
- [ ] 中文句子结构自然
- [ ] **不是**纯中文翻译
- [ ] **不是**纯英文段落

---

## 🐛 如果双语穿插还是不显示

### 调试步骤

#### 1. 检查数据是否正确生成
在控制台执行：
```javascript
const pages = getCurrentPages();
const page = pages[pages.length - 1];
console.log('Mixed paragraph:', page.data.paragraphMixedNodes);
console.log('Session data:', page.data.session?.paragraph?.mixed);
```

**预期输出**:
```
Mixed paragraph: 在当今世界，我们不能 abandon 我们的目标...
Session data: 在当今世界，我们不能 abandon 我们的目标...
```

#### 2. 检查 rich-text 组件
在 `session/index.wxml` 第47行，确认使用的是：
```xml
<rich-text nodes="{{currentParagraphMode === 'mixed' ? paragraphMixedNodes : paragraphEnglishNodes}}" user-select="true"></rich-text>
```

#### 3. 强制刷新
1. 关闭小程序预览
2. 点击"清除缓存" → "清除全部缓存"
3. 重新编译运行

---

## 🔄 恢复AI模式

当需要恢复使用AI生成时，修改 `index/index.js` 第230行：

```javascript
// 改回这样：
const aiAvailable = !!(wx.cloud && wx.cloud.extend && wx.cloud.extend.AI);
```

---

## 📝 本地数据位置

如需修改本地示例数据：
- **文件**: `miniprogram/pages/index/index.js`
- **函数**: `buildMockSession` (第908-931行)
- **可修改**: 单词列表、全英文段落、双语穿插段落

---

## ❓ 常见问题

### Q1: 为什么要用本地数据？
**A**: 方便测试，无需等待AI生成，可以快速验证功能

### Q2: 本地数据和AI数据有什么区别？
**A**: 
- 本地数据：固定内容，加载快
- AI数据：每次生成不同，需要网络请求

### Q3: 双语穿插的标准是什么？
**A**: 
- ✅ 中文为主，英文单词穿插其中
- ✅ 例如："我们要 explore 这个 complex 的问题"
- ❌ 不是全中文："我们要探索这个复杂的问题"
- ❌ 不是全英文："We need to explore this complex problem"

---

## 📞 需要帮助？

如果测试过程中遇到问题：
1. 检查控制台错误日志
2. 确认文件修改是否保存
3. 尝试清除缓存重新编译
4. 查看 `docs/guides/TEST_GUIDE.md` 获取更多调试信息
