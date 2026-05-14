---
title: Singleton Cache Pattern
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Architecture
scope: project-scoped
---

# Singleton Cache Pattern

## 原则摘要

对于昂贵的初始化操作（StateManager、Plugin 实例），使用全局 Map 缓存实例，确保同一个配置（traceDir）只创建一个实例，避免重复初始化的开销和状态不一致。

## 为什么要这样

StateManager 的初始化涉及 SQLite 数据库加载、Schema 创建等耗时操作。如果在每次调用时都创建新实例，会导致：
1. 性能下降（重复的数据库初始化）
2. 状态不一致（多个实例可能持有不同的内存状态）
3. 资源浪费（多个 SQLite 连接）

通过单例缓存，既保证了性能，又确保了全局状态一致性。

**证据**：
- `store/index.ts:58-69` - managers 和 initPromises 双 Map 缓存
- `record/control.ts:20-35` - 同样的单例缓存模式
- `plugin-instance.ts:39` - 全局 testPlugin 实例

## 适用范围

- M001.1-Store (StateManager 缓存)
- M001.5-Record (StateManager 缓存)
- M003-Plugin (TracePlugin 实例)

## 规则

1. **缓存结构**：使用两个 Map - `managers` 存储实例，`initPromises` 存储初始化 Promise
2. **键选择**：以 `traceDir` 为缓存键，不同目录有独立实例
3. **初始化保护**：
   ```typescript
   if (!managers.has(traceDir)) {
     managers.set(traceDir, new StateManager(traceDir));
     initPromises.set(traceDir, manager.init());
   }
   await initPromises.get(traceDir);
   ```
4. **异步安全**：使用 initPromises 防止并发初始化竞态条件

## 反模式 / 禁止项

- ❌ 在每次函数调用中创建新的 StateManager 实例
- ❌ 使用单例缓存但不处理异步初始化竞态
- ❌ 缓存键不一致导致同一配置产生多个实例

## 修改检查清单

- [ ] 添加新的需要缓存的组件时，遵循双 Map 模式
- [ ] 修改 traceDir 配置时，确保缓存键一致性
- [ ] 测试并发调用场景，验证无重复初始化
- [ ] 如原则发生变化，已同步更新 SKILL 总览