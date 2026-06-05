---
project: opencode-trace
type: development-principle
description: "所有关键数据写入必须通过 .tmp→safeRename 保证原子性，3次重试+指数退避以兼容 Windows NTFS。绝不在生产路径使用裸 renameSync/writeFileSync。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 工程
principle_scope: project-scoped
---

# 原子写入原则

## 原则详细描述

本项目将文件系统作为数据真相来源（File System is Source of Truth），因此写入操作的完整性是系统可靠性的基石。所有持久化数据（config.json、TraceRecord JSON、timeline.ndjson、parsed cache）必须通过原子写入模式保证完整性：先写入 `.tmp` 临时文件，再通过 `safeRename()` 重命名为最终路径。`safeRename()` 实现 3 次重试 + 指数退避（50ms×attempt），覆盖 Windows NTFS 的 `EACCES`/`EPERM` 瞬态锁错误。

## 为什么要这样

- POSIX 上 `rename()` 是原子操作，但 **Windows NTFS 上 `renameSync` 可能因文件锁（杀毒软件、延迟 flush）失败**，返回 EACCES/EPERM
- 裸 `writeFileSync` 在进程崩溃时可能产生半写文件，破坏数据完整性
- 项目 CI 在 Linux + Windows 双平台运行，必须保证跨平台兼容
- 当前 state 模块的 `writeConfig()` 使用裸 `renameSync`（state/index.ts:129），违反了此原则；plugin 的 `safeRename`（write-queue.ts:138-163）是正确实现

## 适用范围

- 所有 `.json` 配置文件写入（config.json、metadata.json）
- 所有 `{seq}.json` TraceRecord 写入
- 所有 `timeline.ndjson` 追加写入
- 所有 `.sse` 流文件写入
- 所有 `.parsed` 缓存文件写入

## 规则

- 所有 .tmp→rename 写入路径必须使用 `safeRename` 或等价重试机制
- 临时文件统一使用 `.tmp` 后缀
- 重试逻辑仅覆盖 `EACCES` 和 `EPERM` 两种 Windows 错误码
- 写入失败时必须有 fallback 保全机制（如 writeFallback 到 fallback/ 目录）

## 反模式 / 禁止项

- ❌ 使用裸 `renameSync()` 替代 `safeRename()`（如当前 state/index.ts:129）
- ❌ 使用裸 `writeFileSync()` 直接写入最终文件（如当前 writeMetadataFile）
- ❌ 使用裸 `fs.rename()` 无重试逻辑（如当前 plugin-instance.ts wrapStreamResponse flush）
- ❌ 忽略 Windows CI 上的 EACCES/EPERM 错误

## 修改检查清单

- [ ] 新增 .tmp→rename 写入路径时，必须使用 safeRename（非裸 renameSync）
- [ ] 修改 safeRename 重试逻辑时，确保仍覆盖 EACCES 和 EPERM
- [ ] 在 Windows CI 上测试所有 rename 操作
- [ ] 修复 state/index.ts:129 的裸 renameSync → safeRename
- [ ] 修复 writeMetadataFile 的裸 writeFileSync → .tmp+safeRename