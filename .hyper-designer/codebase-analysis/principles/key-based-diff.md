---
title: Key-based Diff Algorithm
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Architecture
scope: module-scoped (M001.4-Query)
---

# Key-based Diff Algorithm

## 原则摘要

比较两个对话状态的差异时，使用稳定键（stable key）而非深度比较。为每种 Block 类型设计特定的键生成规则，通过 Set 计算差集，O(n) 复杂度。

## 为什么要这样

buildSessionTimeline 需要计算相邻请求之间的对话差异。如果深度比较每个 Block 对象：
1. 时间复杂度高（O(n²) 甚至更高）
2. 对象结构变化时容易出错
3. 无法正确识别"相同内容但不同对象"的情况

通过稳定键：
- 时间复杂度 O(n)
- 键生成规则明确，易于调试
- 内容相同 → 键相同，正确识别新增/删除

**证据**：
- `query/session.ts:6-25` - blockKey 和 msgKey 函数
- `query/session.ts:31-109` - diffConversations 使用 Set 计算差集
- Key 规则：text/thinking 用前50字符，tc 用 id+name，image 用前50字符等

## 适用范围

- M001.4-Query (diffConversations)

## 规则

1. **Block Key**：
   - text: `"text:" + first50Chars`
   - thinking: `"thinking:" + first50Chars`
   - tool_call: `"tc:" + id + ":" + name`
   - image: `"image:" + first50Chars`
   - code_execution: `"code_exec:" + first50Chars`

2. **Message Key**：`"msg:" + id + ":" + role`

3. **Diff 计算**：
   - prevKeys Set vs currKeys Set
   - added = currKeys - prevKeys
   - removed = prevKeys - currKeys

4. **首请求处理**：第一个请求使用 buildInitialChange，所有内容视为 added

## 反模式 / 禁止项

- ❌ 使用 JSON.stringify 作为键（不稳定，顺序可能变化）
- ❌ 深度比较对象属性
- ❌ 键生成规则不覆盖所有 Block 类型

## 修改检查清单

- [ ] 新增 Block 类型时，添加对应的 key 生成规则
- [ ] 修改 Block 结构时，检查键生成规则是否需要更新
- [ ] 测试 diffConversations 验证 added/removed 正确识别
- [ ] 如原则发生变化，已同步更新 SKILL 总览