---
name: aet-analyzing-project
description: |
  Use when analyzing a codebase to understand architecture, module boundaries, and project conventions.
  Use when implementing changes that must follow the project's documented principles.
  Triggers: "analyze this repo", "how does this project work", "where is X implemented",
  "what are the coding conventions", "project analysis", "项目分析", "分析这个项目".
  Even if the user only provides a path inside this project, use this skill.
metadata:
  pattern: tool-wrapper
---

# Project Analysis — opencode-trace

## Usage reminders

> **Code first**: This project analysis cannot replace reading the actual code. This document is used to understand the project globally and speed up navigation, but it may be incorrect or outdated relative to the code; always use **this document + the actual code** together. In case of conflict, the actual code always wins.

> **Recommended to load**: Read the `principles/` folder and follow the golden rules documented there when coding.

## File index

| File / Directory | Description | When to read first |
|------------|------|---------|
| `Overview.md` | 项目概览、技术栈、目录结构、环境变量、快速开始 | 首次进入项目时 |
| `Architecture.md` | 系统边界、分层架构、跨切面关注点、5大核心流程、端到端数据流 | 需要理解整体设计时 |
| `Modules.md` | 23 个模块分解、依赖关系、通信模式、耦合热点 | 需要定位功能所属模块时 |
| `components/` | 10 个核心模块的详细分析文档（HIGH+MEDIUM priority） | 需要在某个模块做深层修改时 |
| `principles/` | 9 个开发原则文件（按主题分类） | 编码前 / 重构前 |

## Module index

| ID | Name | Responsibility | Priority | Detail Doc |
|----|------|------|------|------|
| M01 | types | TraceRecord 原始数据类型定义 | HIGH | `components/M01-types.md` |
| M02 | parse | Provider 检测与请求/响应解析→Conversation | HIGH | `components/M02-parse.md` |
| M03 | transform | SSE 流解析与 Entry/Block 转换 | MEDIUM | `components/M03-transform.md` |
| M04 | store | 文件系统 CRUD（6职责混合） | HIGH | `components/M04-store.md` |
| M05 | query | Diff 计算与时间线/元数据聚合 | MEDIUM | `components/M05-query.md` |
| M06 | format | XML 渲染与 collapse/explode 输出 | LOW | — |
| M07 | record | 录制控制 facade | MEDIUM | `components/M07-record.md` |
| M08 | state | ConfigManager 配置持久化+scope解析 | HIGH | `components/M08-state.md` |
| M09 | schemas | Zod 验证 schema | LOW | — |
| M10 | logger | Winston 结构化日志 | LOW | — |
| M11 | platform | OS 路径适配 | LOW | — |
| M12 | cli-entry | CLI 命令路由 | LOW | — |
| M13 | cli-handlers | 8 个命令实现 | LOW | — |
| M14 | cli-utils | Flag/range/session 解析工具 | LOW | — |
| M15 | cli-formatter | 输出格式化 | LOW | — |
| M16 | trace-entry | OpenCode Plugin Hook+Tool 注册 | LOW | — |
| M17 | plugin-instance | fetch 拦截引擎核心 | HIGH | `components/M17-plugin-instance.md` |
| M18 | tracer | 第三方公共 API facade | LOW | — |
| M19 | write-queue | 异步批量原子写入队列 | MEDIUM | `components/M19-write-queue.md` |
| M20 | redact | Header 脱敏 | LOW | — |
| M21 | viewer-server | Fastify HTTP 服务+SSE+chokidar | MEDIUM | `components/M21-viewer-server.md` |
| M22 | viewer-cli | Viewer CLI 入口 | LOW | — |
| M23 | vue-frontend | Vue 3 SPA 前端 | LOW | — |

> LOW priority modules have no dedicated detail document. Refer to `Modules.md` for overview information.

## Principles index

| Principle | Category | File | Scope |
|-----------|----------|------|-------|
| 原子写入原则 | 工程 | `principles/atomic-write.md` | project-scoped |
| 优雅降级原则 | 工程 | `principles/graceful-degradation.md` | project-scoped |
| Windows CI 兼容性原则 | 工程 | `principles/windows-ci-compatibility.md` | project-scoped |
| 类型与验证分离原则 | 工程 | `principles/type-validation-separation.md` | project-scoped |
| 读取性能层次原则 | 架构 | `principles/performance-hierarchy.md` | project-scoped |
| Scope 分级与对称优先级原则 | 架构 | `principles/scope-resolution.md` | project-scoped |
| Registry+策略模式原则 | 架构 | `principles/registry-pattern.md` | category-scoped (parse/transform) |
| 纯计算原则 | 架构 | `principles/pure-computation.md` | category-scoped (query/parse/transform) |
| 文件系统即真相来源原则 | 架构 | `principles/file-system-as-source.md` | project-scoped |

## Notes

### Scenarios that should trigger this skill

- Need to quickly understand the project's overall architecture
- Need to determine which module a feature belongs to
- Need to follow existing project conventions for naming, error handling, or logging
- Need to confirm dependency impact before making changes
- Need to consolidate analysis results into reusable development principles

### Things this skill should NOT replace

- Do not use analysis documents instead of reading actual source code
- Do not mistake a single module's habits for global conventions
- Do not guess design intent without evidence

## How to use

1. Read `Overview.md` and `Architecture.md` first.
2. Then locate by functionality: read `Modules.md` and the corresponding `components/*.md`.
3. Before coding, check `principles/*.md` for golden rules.
4. When conflicts arise, use source code and architectural evidence as the source of truth.

## Key architectural insights

### Critical design decisions

1. **File System as Source of Truth**: No database. All data in `~/.opencode-trace/` as JSON files. Atomic writes via `.tmp` + `safeRename()` ensure crash safety.

2. **Three-tier Scope Model**: Enable resolution — largest scope wins (global → local → session). Storage resolution — smallest scope wins (session → global).

3. **Fetch Interception Pattern**: Monkey-patches `globalThis.fetch` to intercept ALL HTTP calls. Only records those with session headers and where `shouldRecord()` returns true.

4. **Read Performance Hierarchy**: timeline.ndjson (fastest) → {seq}.parsed cache → {seq}.json + detectAndParse (slowest). Viewer falls back gracefully.

5. **Parsed Cache Versioning**: `PARSED_CACHE_VERSION = "1"` in `parse/index.ts`. Must increment when Conversation type structure changes.

### Known architectural risks

1. **ConfigManager cache inconsistency**: 3 independent caches (store, record, plugin) with no invalidation protocol.
2. **Mixed sync/async I/O**: `renameSync` in state module vs `safeRename` in write-queue.
3. **No authentication on Viewer API**: All conversation data exposed to any local process.
4. **Request body not redacted**: Only headers are redacted; API keys may appear in payloads.
5. **store module overweight**: 792 lines, 6+ responsibilities — primary refactoring target.
6. **parse↔transform circular dependency**: Bidirectional imports accepted as design trade-off; recommend extracting shared model module.