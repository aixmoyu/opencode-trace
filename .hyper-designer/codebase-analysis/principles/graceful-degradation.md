---
title: Graceful Degradation
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Engineering
scope: project-scoped
---

# Graceful Degradation

## 原则摘要

当核心组件（StateManager/SQLite）不可用或初始化失败时，系统应自动降级到备选方案（文件系统），确保核心功能仍然可用，而不是直接失败。

## 为什么要这样

opencode-trace 作为追踪工具，其核心价值是记录和查询数据。如果因为 SQLite 初始化失败导致整个系统不可用，用户体验极差。通过优雅降级机制，即使数据库层出现问题，用户仍可通过文件系统查看和操作数据。

**证据**：
- `store/index.ts:88-166` - listSessions 在 StateManager 未初始化时自动回退到文件系统扫描
- `record/control.ts:119-130, 161-189` - isRecording 和 listRecordings 在 StateManager 不可用时使用文件系统检查
- `state/index.ts:146-164` - SQLite 损坏时自动重建数据库

## 适用范围

- M001.1-Store (数据存储层)
- M001.6-State (状态管理层)
- M001.5-Record (录制控制层)
- M003-Plugin (插件入口)

## 规则

1. **StateManager 初始化失败时**：所有依赖 StateManager 的查询函数应回退到文件系统扫描
2. **SQLite 损坏时**：StateManager 应检测损坏并重建数据库，同时保留现有数据
3. **关键操作降级优先级**：
   - 查询操作（listSessions, getSessionRecords）→ 必须降级
   - 写入操作（writeRecord）→ 降级到直接文件写入
   - 状态管理（isTraceEnabled）→ 默认启用（true）

## 反模式 / 禁止项

- ❌ 在 StateManager 初始化失败时直接抛出异常
- ❌ 不提供备选方案的单点依赖
- ❌ 假设 SQLite 永远可用，不做错误处理

## 修改检查清单

- [ ] 修改 StateManager 相关函数时，添加或保留文件系统回退逻辑
- [ ] 新增查询功能时，考虑 StateManager 不可用的场景
- [ ] 测试降级路径：模拟 SQLite 初始化失败，验证功能可用性
- [ ] 如原则发生变化，已同步更新 SKILL 总览