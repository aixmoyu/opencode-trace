---
project: opencode-trace
type: development-principle
description: "使用 Registry + Side-effect Import 模式管理可扩展组件（如 Parser），开放扩展、封闭修改。新增功能只需实现接口+自注册，无需修改核心编排逻辑。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 架构
principle_scope: category-scoped (M02-parse, M03-transform)
---

# Registry + 策略模式原则

## 原则详细描述

对于需要支持多种实现的可扩展组件（如 LLM Provider Parser），使用 **Registry 模式**管理选择逻辑，而非在编排器中硬编码 switch/case 分支。配合 **Side-effect Import**（导入即注册），新增提供商只需：

1. 创建 parser 文件，实现 `Parser` 接口（match/parseRequest/parseResponse）
2. 文件末尾添加 `registerParser(newParser)` 自注册调用
3. 在 index.ts 添加 `import "./new-provider.js"` 侧效果导入

无需修改 `detectAndParse()` 核心逻辑。

## 为什么要这样

- LLM API 格式差异不可避免，但统一数据模型是必需的
- 新增提供商应是"添加"而非"修改"，符合开放-封闭原则
- Side-effect Import 避免手动维护注册列表的遗漏风险
- 与 SSE 解析器的路由模式一致（detect.ts → transform SSE parsers）

## 适用范围

- LLM Provider Parser 注册（M02-parse registry.ts）
- SSE 解析器路由（M02-parse detect.ts → M03-transform SSE parsers）
- 未来可能的 Provider Registry（M17-plugin-instance buildTimelineEntry）

## 规则

- 所有可扩展组件使用 `registerXxx()` + `getXxxs()` API
- 自注册在模块末尾调用，由 index.ts 的 import 触发
- 新增实现必须提供 match() 判断逻辑，避免误匹配
- 测试中使用 `clearParsersForTesting()` 重置注册表

## 反模式 / 禁止项

- ❌ 在 detectAndParse 中使用硬编码 if/else provider 分支
- ❌ 手动维护 parser 注册列表（应使用 import 侧效果触发）
- ❌ match() 逻辑过于宽泛（如 URL contains "openai" 会误匹配代理 URL）

## 修改检查清单

- [ ] 新增 Parser 后：确认 index.ts 添加了侧效果 import 和 export
- [ ] 新增 SSE parser 后：确认 detect.ts 的 parseSSEMessagesWithUsage 中添加路由
- [ ] 修改 match 逻辑时：确认不误匹配其他 provider
- [ ] 使用 `clearParsersForTesting()` 在测试中重置注册表