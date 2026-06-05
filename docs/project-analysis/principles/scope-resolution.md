---
project: opencode-trace
type: development-principle
description: "三层 scope 分级采用对称反向优先级：Enable 最大优先（global ON 强制记录），Storage 最小优先（session 级 preference 覆盖全局）。体现了权限向下传递、配置向上细化的设计理念。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 架构
principle_scope: project-scoped
---

# Scope 分级与对称优先级原则

## 原则详细描述

项目采用三层独立 scope 控制 trace 启用/禁用和存储位置，使用**对称但反向的优先级策略**：

**Enable Resolution（最大优先）**：
- `global_trace_enabled === true` → ON（无视所有 local/session 级设置）
- `global_trace_enabled === false` → 检查 local → local true → ON → local false → 检查 session
- 确保运维可通过全局开关强制启用/禁用 trace

**Storage Resolution（最小优先）**：
- Session 有 `storage_preference` → 使用 session preference
- Session 无 preference → 使用 global config `storage_preference`（默认 "global"）
- 允许会话自主决定存储位置（如项目级 trace 存到 local 目录）

## 为什么要这样

- **Enable largest-wins**：运维需要全局控制开关。如果 global=false 但 local=true 仍允许录制，则运维无法在全局层面禁止追踪
- **Storage smallest-wins**：不同会话可能需要不同存储位置。一个调试会话可能想存到项目目录（local），而日常会话存到全局目录（global）
- 对称反向设计体现了"权限向下传递、配置向上细化"的理念

## 适用范围

- 所有 trace 启用/禁用判断（M17-plugin-instance shouldRecord, M08-state isTraceEnabled）
- 所有 trace 存储位置解析（M17-plugin-instance resolveTraceDir）
- CLI enable/disable 命令的 scope 参数处理
- Agent tools（trace_on/trace_off/trace_status）

## 规则

- shouldRecord() 必须完整实现三层 scope（global→local→session）
- resolveTraceDir() 必须完整实现两层 storage（session→global default）
- ConfigManager 的 isTraceEnabled() 当前只实现了两层（global→session），local 层在 plugin-instance.ts 补充——新代码不应依赖 ConfigManager 的 incomplete 实现

## 反模式 / 禁止项

- ❌ 在 shouldRecord 中只检查一层 scope（遗漏 global 或 local）
- ❌ 混淆 Enable 和 Storage 的优先级方向（两者是反向的）
- ❌ 依赖 ConfigManager.isTraceEnabled() 做完整三层判断（它只实现两层）

## 修改检查清单

- [ ] 修改 shouldRecord() 时，验证三层 scope 优先级仍然正确
- [ ] 修改 resolveTraceDir() 时，验证两层 storage 优先级仍然正确
- [ ] 新增 scope 级别时，保持对称反向优先级设计
- [ ] 确保 CLI 和 Agent tools 的 scope 参数与 plugin 逻辑一致