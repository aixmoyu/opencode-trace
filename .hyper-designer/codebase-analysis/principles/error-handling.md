---
title: Error Handling Pattern
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Engineering
scope: project-scoped
---

# Error Handling Pattern

## 原则摘要

非关键操作失败时，使用 logger.error 记录错误并继续执行，而不是抛出异常中断流程。只有在必须通知调用者的场景（如导出导入、用户显式操作）才抛出异常。

## 为什么要这样

opencode-trace 作为后台追踪工具，不应因单个请求记录失败而中断整个系统。如果采用抛出异常模式：
1. 单个 I/O 失败会导致整个追踪中断
2. 用户可能错过重要对话记录
3. 系统稳定性降低

通过 logger.error + 继续执行：
- 失败被记录，便于排查
- 其他请求继续被追踪
- 系统稳定性提高

**证据**：
- `store/index.ts:44-56` - safeReaddir 捕获 ENOENT 等，返回空数组
- `plugin-instance.ts:155-186` - recordResponse 捕获写入错误，仅记录日志
- `state/index.ts:70-96` - init 捕获 SQLite 错误，降级到 filesystemOnly

## 适用范围

- M001-Core (所有子模块)
- M002-CLI (命令处理器)
- M003-Plugin (拦截器)
- M004-Viewer (HTTP 服务)

## 规则

1. **读取操作失败**：返回空结果（[]、null），不抛异常
2. **写入操作失败**：记录日志，尝试 fallback（如 write-queue.ts:55-71）
3. **用户交互失败**：抛出异常，返回错误响应（如 export/import）
4. **日志格式**：使用结构化 logger，包含 module、function、error details

## 反模式 / 禁止项

- ❌ 所有操作失败都抛出异常
- ❌ 捕获异常后不记录日志，静默忽略
- ❌ 使用 console.log/error 替代 logger

## 修改检查清单

- [ ] 新增读取函数时，使用 try-catch + logger.error + 返回空结果
- [ ] 新增写入函数时，考虑 fallback 方案
- [ ] 用户交互 API 失败时，返回明确的错误响应
- [ ] 如原则发生变化，已同步更新 SKILL 总览