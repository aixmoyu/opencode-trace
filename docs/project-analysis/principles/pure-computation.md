---
project: opencode-trace
type: development-principle
description: "数据变换模块应无 I/O、无副作用、无状态。将原始数据变换为聚合视图而非存储中间结果，便于测试和组合。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 架构
principle_scope: category-scoped (M05-query, M02-parse, M03-transform)
---

# 纯计算原则

## 原则详细描述

数据变换模块（query、parse、transform）应遵循纯计算原则：所有导出函数无 I/O 副作用、无外部状态依赖、无文件系统操作。它们只做数据变换——将原始 TraceRecord/Conversation 变换为增量视图（Delta）、时间线摘要（SessionTimeline）、统计聚合（SessionMetadata）。

纯函数特征：相同输入永远产生相同输出，便于测试（无需 mock 文件系统），便于组合（可在任何上下文调用）。

## 为什么要这样

- 查询/解析逻辑与 I/O 解耦后可独立测试，无需 mock 文件系统
- 纯函数无并发安全问题，无缓存一致性风险
- Viewer 可直接消费预计算结果，无需实时 diff
- 便于在不同上下文复用（CLI export 和 Viewer timeline 使用同一 query 函数）

## 适用范围

- M05-query（diffConversations, buildSessionTimeline, buildSessionMetadata）
- M02-parse（detectAndParse — 纯数据变换，不含文件写入）
- M03-transform（SSE 解析 — 纯文本→结构变换）

## 规则

- 所有导出函数为纯函数：无 fs 操作、无网络请求、无状态修改
- 使用 `?? 0` 处理 null/undefined 数值字段，避免 NaN 传播
- 使用 Set-based diff 保证 O(n) 而非 O(n²)
- 使用确定性键（blockKey/msgKey）而非引用相等性

## 反模式 / 禁止项

- ❌ 在 query/parse/transform 中直接读写文件系统
- ❌ 在纯函数中依赖外部状态或全局变量
- ❌ 使用引用相等性做 diff（应使用确定性字符串键）

## 修改检查清单

- [ ] 新增导出函数时，确认无 I/O 副作用
- [ ] 新增统计维度时，确保 null 值处理一致
- [ ] 修改 blockKey/msgKey 时，确认所有 Block/Entry 类型正确映射