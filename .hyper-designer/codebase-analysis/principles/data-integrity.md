---
title: Data Integrity Priority
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Engineering
scope: project-scoped
---

# Data Integrity Priority

## 原则摘要

当涉及数据一致性时（如删除会话、导入冲突），优先保证数据完整性而非性能或便利性。例如删除父会话时必须同时删除所有子会话，避免孤儿数据。

## 为什么要这样

opencode-trace 的会话数据有父子关系（task 工具创建子会话）。如果删除父会话时留下子会话：
1. 子会话的 parentID 指向不存在的会话，导致查询错误
2. 时间线展示混乱，无法正确追溯子会话来源
3. 导入导出时可能携带不一致的父子关系

通过级联删除，确保数据一致性。

**证据**：
- `store/index.ts:518-540` - deleteSession 级联删除子会话
- `store/index.ts:358-359` - exportSessionZip 包含所有子会话
- `plugin/trace.ts:79-81` - session created 时记录父子关系

## 适用范围

- M001.1-Store (会话删除、导出)
- M003-Plugin (会话关系记录)
- M004-Viewer (会话删除 API)

## 规则

1. **删除操作**：删除父会话时必须同时删除所有子会话
2. **导出操作**：导出主会话时必须包含所有子会话
3. **导入冲突**：导入时检测父子关系一致性，冲突时提示用户
4. **关系更新**：子会话创建时立即记录到父会话的 subSessions 列表

## 反模式 / 禁止项

- ❌ 删除父会话时仅删除父会话目录
- ❌ 导出不包含子会话，导致导入后关系断裂
- ❌ 不维护 subSessions 列表，仅依赖 parentID 单向引用

## 修改检查清单

- [ ] 修改 deleteSession 时验证级联删除逻辑
- [ ] 修改 exportSessionZip 时确保包含子会话
- [ ] 修改导入逻辑时检测父子关系一致性
- [ ] 测试删除父会话后，验证无孤儿子会话
- [ ] 如原则发生变化，已同步更新 SKILL 总览