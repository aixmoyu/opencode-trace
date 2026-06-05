---
project: opencode-trace
type: development-principle
description: "读取优先使用最快的数据源：timeline.ndjson → parsed cache → raw JSON + detectAndParse。每层 fallback 更慢但始终正确。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 架构
principle_scope: project-scoped
---

# 读取性能层次原则

## 原则详细描述

Viewer 读取数据遵循三级降级路径，确保大多数请求走快速路径：

1. **timeline.ndjson**（最快）— 轻量级摘要索引，一行 JSON per record，无需解析
2. **{seq}.parsed**（中速）— 缓存的 detectAndParse 输出，跳过全量解析
3. **{seq}.json + detectAndParse()**（最慢但始终正确）— 源文件全量解析

每层 fallback 更慢但永远正确。当 ndjson 缺失/损坏时，异步重建（fire-and-forget）。

## 为什么要这样

- Viewer 是实时浏览工具，用户打开后会持续浏览，首次请求可以慢但后续必须快
- 全量 detectAndParse 对长对话（数百条记录）极其耗时
- parsed cache 版本控制（_pcv）确保缓存失效时自动回退
- ndjson 是 append-only 写入，几乎零维护成本

## 适用范围

- Viewer 所有数据读取端点（timeline, metadata, records）
- CLI show/export 命令的记录读取

## 规则

- 读取路径必须按 ndjson → parsed cache → full parse 顺序尝试
- parsed cache 必须检查 _pcv 版本和 mtime 新鲜度
- ndjson 缺失时触发异步重建（不阻塞请求）
- 永远不要跳过 full parse fallback——它是最终的正确来源

## 反模式 / 禁止项

- ❌ 直接跳到 full parse 而不先尝试 ndjson/parsed cache
- ❌ 忽略 parsed cache 的 _pcv 版本检查（会导致展示过期数据）
- ❌ 在 parsed cache 读取失败时 throw（应静默回退到 full parse）

## 修改检查清单

- [ ] 新增读取端点时，遵循三级降级路径
- [ ] 修改 parsed cache 格式时，递增 PARSED_CACHE_VERSION
- [ ] 修改 ndjson 格式时，确保 viewer 的重建逻辑兼容
- [ ] 检查 _pcv 版本和 mtime 新鲜度逻辑是否覆盖所有 parsed cache 读取