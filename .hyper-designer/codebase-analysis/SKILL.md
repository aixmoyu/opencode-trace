---
name: opencode-trace-analysis
description: |
  opencode-trace 项目分析文档。用于追踪 OpenCode AI 交互的工具套件分析结果。
  包含项目概览、系统架构、模块分析等完整文档。
metadata:
  pattern: project-analysis
---

# opencode-trace 项目分析

## Usage reminders

> **Code first**: 本项目分析文档不能替代阅读实际代码。本文档用于全局理解项目并加速导航，但可能相对于代码有误或不完整；始终使用 **本文档 + 实际代码** 结合使用。如有冲突，实际代码为准。

## File index

| File / Directory | Description | When to read first |
|------------|------|---------|
| `overview.md` | 项目概览、技术栈、目录结构 | 初次进入项目时 |
| `architecture.md` | 系统边界、分层结构、核心流程 | 理解整体设计时 |
| `modules.md` | 模块分解、依赖关系、通信模式 | 定位功能所属模块时 |
| `components/` | 各模块详细分析文档（12 个文件） | 开发特定模块前 |
| `principles/` | 项目开发原则（8 个文件） | 需要遵循项目规范时 |

## Module index

| ID | Name | Responsibility | Doc |
|----|------|------|------|
| M001 | Core | 核心功能包：解析、存储、查询、格式化 | [C001-Core.md](components/C001-Core.md) |
| M001.1 | Store | 数据持久化（文件读写、SQLite 状态） | [C002-Store.md](components/C002-Store.md) |
| M001.2 | Parse | AI Provider 解析器（OpenAI/Anthropic） | [C003-Parse.md](components/C003-Parse.md) |
| M001.3 | Transform | SSE 流转换 | [C009-Transform.md](components/C009-Transform.md) |
| M001.4 | Query | 查询构建（Timeline、Metadata） | [C005-Query.md](components/C005-Query.md) |
| M001.5 | Record | 录制控制（全局/会话开关） | [C006-Record.md](components/C006-Record.md) |
| M001.6 | State | 状态管理（StateManager 类） | [C004-State.md](components/C004-State.md) |
| M001.7 | Format | 格式化导出（XML、Collapse） | [C010-Format.md](components/C010-Format.md) |
| M001.8 | Schemas | Zod Schema 定义 | [C011-Schemas.md](components/C011-Schemas.md) |
| M002 | CLI | 命令行工具包 | [C012-CLI.md](components/C012-CLI.md) |
| M003 | Plugin | OpenCode 插件包 | [C007-Plugin.md](components/C007-Plugin.md) |
| M004 | Viewer | Web 查看器包 | [C008-Viewer.md](components/C008-Viewer.md) |

## Principles index

| Principle | Category | Scope | Doc |
|-----------|----------|-------|-----|
| Graceful Degradation | Engineering | project | [graceful-degradation.md](principles/graceful-degradation.md) |
| Singleton Cache Pattern | Architecture | project | [singleton-cache.md](principles/singleton-cache.md) |
| Parser Registry Pattern | Architecture | module | [parser-registry.md](principles/parser-registry.md) |
| Async Queue Pattern | Engineering | module | [async-queue.md](principles/async-queue.md) |
| Data Integrity Priority | Engineering | project | [data-integrity.md](principles/data-integrity.md) |
| Non-invasive Interception | Architecture | module | [non-invasive-interception.md](principles/non-invasive-interception.md) |
| Error Handling Pattern | Engineering | project | [error-handling.md](principles/error-handling.md) |
| Key-based Diff Algorithm | Architecture | module | [key-based-diff.md](principles/key-based-diff.md) |

## 项目关键信息摘要

### 项目定位
**opencode-trace** 是用于追踪和分析 OpenCode AI 交互的工具套件。通过拦截 HTTP 请求记录 AI API（OpenAI、Anthropic）的完整交互过程，提供 CLI、Web Viewer 和 OpenCode Plugin 三种使用方式。

### 核心数据流
```
HTTP Request → Plugin拦截 → Core-Parse解析 → Core-Store存储 → Core-Query查询 → Viewer/CLI展示
```

### 关键目录
- `~/.opencode-trace/` — trace 数据存储目录
  - `<session-id>/` — 会话目录
    - `<seq>.json` — 单次请求记录
    - `<seq>.sse` — SSE 流数据
    - `metadata.json` — 会话元数据
  - `state.db` — SQLite 状态数据库

### 重要设计决策
1. **Parser Registry Pattern** — 支持注册新的 AI provider parser
2. **Async Write Queue** — 异步写入避免阻塞 fetch
3. **SQLite Fallback** — StateManager 支持 fallback 到文件系统
4. **Header Redaction** — 模糊化敏感信息（用户路径、IP）

## Notes

### Scenarios that should trigger this skill

- 需要快速理解 opencode-trace 项目整体架构
- 需要确定某个功能属于哪个模块
- 需要遵循项目现有的命名、错误处理、日志规范
- 需要在修改前确认依赖影响
- 需要了解 AI Provider 解析机制

### Things this skill should NOT replace

- 不要用分析文档代替阅读实际源代码
- 不要把单个模块的习惯当作全局规范
- 不要在没有证据的情况下猜测设计意图

## How to use

1. 先阅读 `overview.md` 和 `architecture.md` 了解项目全局。
2. 定位功能时，查阅 `modules.md` 找到对应模块。
3. 开发前，检查模块的关键文件和依赖关系。
4. 出现冲突时，以源代码和架构证据为准。

## Quick Reference

### 构建 & 运行
```bash
npm run build    # 构建所有包
npm run test     # 运行测试
npm run cli      # 运行 CLI
npm run viewer   # 运行 Viewer
```

### CLI 命令速查
```bash
opencode-trace enable      # 启用 trace
opencode-trace disable     # 禁用 trace
opencode-trace status      # 查看状态
opencode-trace list        # 列出会话
opencode-trace show <id>   # 显示详情
opencode-trace export <id> # 导出数据
opencode-trace viewer      # 启动 Viewer
```

### Core 导出速查
```typescript
import {
  store,    // 数据持久化
  parse,    // AI Provider 解析
  transform, // SSE 流转换
  query,    // 查询构建
  record,   // 录制控制
  state,    // 状态管理
  format,   // 格式化导出
  schemas,  // Zod Schema
  logger,   // 日志
} from '@opencode-trace/core';
```