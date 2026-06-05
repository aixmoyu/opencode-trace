---
project: opencode-trace
type: development-principle
description: "CI 在 Linux+Windows 双平台运行，所有代码必须兼容 Windows NTFS。路径构建必须用 path.join/tmpdir，文件过滤必须用正则而非 .endsWith()，异步写入后必须 flush 再断言。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 工程
principle_scope: project-scoped
---

# Windows CI 兼容性原则

## 原则详细描述

项目 CI 在 ubuntu-latest + windows-latest 双平台运行（fail-fast: false）。Windows NTFS 的文件系统行为与 POSIX 显著不同：

1. `fs.rename()` 在 Windows 上不是原子操作——可能因 EACCES/EPERM 失败（杀毒软件锁、延迟 flush）
2. `readdirSync` 在 Windows 上可能不立即反映异步写入——需要 flush + poll
3. `path.join` 在 Windows 上产生反斜杠路径——硬编码 POSIX 路径的断言会失败
4. 文件写入在 Windows 上更慢——测试超时需要余量

## 为什么要这样

- 项目 CI matrix 包含 windows-latest，任何 POSIX-only 代码都会导致 Windows CI 失败
- NTFS 的元数据缓存行为与 ext4/APFS 不同，必须 flush 后再断言
- 路径分隔符差异是跨平台代码最常见的陷阱

## 适用范围

- 所有 fs.rename/renameSync 操作（必须用 safeRename）
- 所有测试中的路径构建（必须用 path.join + os.tmpdir()）
- 所有测试中的文件计数（必须用 /^\d+\.json$/ 而非 .endsWith）
- 所有异步写入后的断言（必须先 flush）

## 规则

- fs.rename 操作必须使用 safeRename（3 次重试 + exponential backoff）
- 测试路径必须用 `path.join(tmpdir(), ...)` 构建，而非硬编码 POSIX
- 测试断言的期望值必须用相同的 path helpers 构建
- 文件计数必须用 `/^\d+\.json$/` 正则过滤，不用 `.endsWith(".json")`
- 异步写入后必须调用 `plugin.flush()` 再断言文件数量

## 反模式 / 禁止项

- ❌ 使用裸 `fs.rename()`/`renameSync()` 在生产写入路径
- ❌ 使用 `.endsWith(".json")` 计数 record 文件（会匹配 metadata.json/config.json）
- ❌ 硬编码 POSIX 路径（如 `/tmp/out/main.json`）在断言中
- ❌ 假设异步写入立即可见（Windows 上 readdirSync 可能延迟）
- ❌ 测试超时过短（Windows CI 上 I/O 更慢）

## 修改检查清单

- [ ] 新增 fs.rename 操作时使用 safeRename
- [ ] 测试路径使用 path.join + os.tmpdir()
- [ ] 测试断言的期望值使用相同 path helpers
- [ ] 文件过滤使用 /^\d+\.json$/ 正则
- [ ] 异步写入后先 flush 再断言