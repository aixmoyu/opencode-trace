---
title: Async Queue Pattern
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Engineering
scope: module-scoped (M003-Plugin)
---

# Async Queue Pattern

## 原则摘要

数据持久化操作（文件写入、SQLite 更新）通过异步队列批量处理，避免阻塞主请求流程。Plugin 拦截 fetch 后，立即将数据入队，然后返回响应，后台异步执行写入。

## 为什么要这样

Plugin 在拦截 OpenCode 的 API 请求时，如果同步写入文件和更新 SQLite，会增加请求延迟，影响用户体验。通过异步队列：
1. 请求响应延迟最小化（仅内存入队）
2. 批量写入提高 I/O 效率
3. 写入失败不影响请求结果（已有响应返回）

**证据**：
- `plugin-instance.ts:155-186` - recordResponse 入队后立即返回
- `write-queue.ts:17-35` - 批量处理写入队列
- `state-queue.ts:19-44` - 批量状态更新队列

## 适用范围

- M003-Plugin (写入和状态队列)

## 规则

1. **双队列设计**：AsyncWriteQueue（文件写入）和 AsyncStateQueue（SQLite 更新）分离
2. **批量大小**：默认 batchSize=10，可配置
3. **入队时机**：响应完成后立即入队，不等待写入
4. **flush 时机**：
   - Plugin 生命周期结束时调用 flush
   - 测试结束时调用 flush 确保数据写入

## 反模式 / 禁止项

- ❌ 在拦截器中同步等待写入完成
- ❌ 队列无限制增长（高并发场景）
- ❌ 不处理队列写入失败（应记录日志，不中断请求）

## 修改检查清单

- [ ] 修改队列逻辑时，测试高并发场景
- [ ] 添加新的持久化操作时，考虑是否需要入队
- [ ] 测试结束时调用 flush 确保数据写入
- [ ] 如原则发生变化，已同步更新 SKILL 总览