---
project: opencode-trace
type: development-principle
description: "文件系统是数据真相来源，无数据库。所有配置和 trace 数据以 JSON 文件存储在 ~/.opencode-trace/。Store 模块不维护内存缓存，所有读取从磁盘实时获取。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 架构
principle_scope: project-scoped
---

# 文件系统即真相来源原则

## 原则详细描述

项目不使用数据库，所有数据以 JSON 文件存储在 `~/.opencode-trace/`（全局）和 `<project>/.opencode-trace/`（本地）。Store 模块不维护内存数据缓存（除了 ConfigManager 实例缓存），所有读取从磁盘实时获取。

文件布局是"数据宪法"：
- `{seq}.json` — TraceRecord 源文件（不可变，一旦写入不再修改）
- `timeline.ndjson` — append-only 摘要索引（可重建）
- `{seq}.parsed` — 缓存文件（可删除重建，版本化）
- `metadata.json` — 会话元数据（可修改）
- `config.json` — 全局/本地配置（原子写入）

## 为什么要这样

- OpenCode 运行为 CLI 工具，引入数据库会过度侵入
- 文件存储可移植、可调试、人类可读
- 原子写入（.tmp+rename）保证崩溃安全
- JSON 文件可直接用文本编辑器/grep 查看，便于问题诊断

## 适用范围

- 所有 trace 数据存储（Plugin 写 → Viewer 读）
- 所有配置存储（ConfigManager）
- 所有会话元数据（metadata.json）

## 规则

- Store 模块读取从磁盘实时获取，不维护数据内存缓存
- Plugin 和 Viewer 通过文件系统共享数据，无直接函数调用
- Viewer 使用 chokidar 监视文件变更，SSE 推送实时更新
- 双目录合并时 local 覆盖 global（local-first 原则）

## 反模式 / 禁止项

- ❌ 引入数据库作为中间层
- ❌ 在 Store 中维护数据内存缓存（ConfigManager 实例缓存除外）
- ❌ Plugin 和 Viewer 直接函数调用传递数据（应通过文件系统）
- ❌ 直接操作文件系统而不通过 Store/State 模块（如 viewer server.ts 的 ndjson cleanup 应通过 store）

## 修改检查清单

- [ ] 新增数据存储格式时，确保写入路径使用原子模式
- [ ] Viewer 修改数据时确保通过 store/state 模块而非直接操作文件
- [ ] 新增 chokidar 监视时确保与 SSE 推送一致