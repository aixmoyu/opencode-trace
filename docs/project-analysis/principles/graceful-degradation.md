---
project: opencode-trace
type: development-principle
description: "系统在每个层级都提供容错降级机制：读取失败返回默认值/null而不崩溃；解析失败尽力提取而非严格验证；缓存缺失回退到全量处理。宁可多记录不漏数据。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 工程
principle_scope: project-scoped
---

# 优雅降级原则

## 原则详细描述

本项目采用"容错优先"策略：每个操作层级都有 fallback 路径，确保系统可降级但不可崩溃、不可丢数据。具体表现为：

1. **配置层**：损坏 JSON → 回退 DEFAULT_CONFIG + log.error（不抛异常）
2. **存储层**：目录不存在 → 返回 [] / null（不抛异常）；ndjson 不可用 → 回退 JSON 扫描
3. **解析层**：不认识的字段 → 归入 OtherBlock（不丢弃）；单个 SSE event 解析失败 → 跳过 + log.debug（不中断整个流）
4. **录制层**：ConfigManager 未初始化 → shouldRecord 返回 true（宁可多记录不漏数据）；setter 失败 → 静默 no-op（不阻塞主流程）
5. **写入层**：主写入失败 → writeFallback 保全（零数据丢失）

## 为什么要这样

- 系统拦截全局 HTTP fetch，任何崩溃都会中断 OpenCode 的正常通信
- TraceRecord 来源是不可控的外部 LLM API，格式可能随时变化
- 文件系统操作在不同 OS/环境下表现不一致，必须容忍意外
- 追踪数据的价值在于完整性，宁可多记录一些无用数据，也不能丢失重要数据

## 适用范围

- 所有 config 读写操作（M08-state）
- 所有文件系统读取操作（M04-store）
- 所有 LLM API 解析操作（M02-parse, M03-transform）
- 所有 fetch 拦截操作（M17-plugin-instance）
- 所有写入操作（M19-write-queue）

## 规则

- 读取函数返回 null/[] 而非抛出异常
- 解析函数使用 `?? ""` / `?? null` 兜底而非 throw
- SSE 事件解析的 JSON.parse 使用 try-catch，失败仅 log.debug
- safeParse 失败返回 null，不 throw
- shouldRecord 在无 session ID 时返回 false（不录制无归属请求）

## 反模式 / 禁止项

- ❌ 在拦截管道中向上层抛出异常（会中断 fetch）
- ❌ 因单个 SSE event 解析失败而中断整条流解析
- ❌ 在 safeParse 失败时 throw（应返回 null）
- ❌ 在目录不存在时 throw（应返回 [] / null）

## 修改检查清单

- [ ] 新增读取函数时，返回 null/[] 而非 throw
- [ ] 新增解析逻辑时，添加 try-catch + ?? 兜底
- [ ] 修改 shouldRecord 逻辑时，确保保守默认（宁可 ON 不漏数据）
- [ ] 修改 safeParse 调用时，确认使用 .safeParse() 而非 .parse()