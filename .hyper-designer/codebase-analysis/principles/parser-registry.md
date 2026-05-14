---
title: Parser Registry Pattern
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Architecture
scope: module-scoped (M001.2-Parse)
---

# Parser Registry Pattern

## 原则摘要

AI Provider 解析器（OpenAI、Anthropic 等）采用自注册模式：每个解析器在模块加载时调用 `registerParser()` 自动向 registry 注册，而不是在 detectAndParse 中硬编码。

## 为什么要这样

opencode-trace 需要支持多个 AI Provider（OpenAI Chat、OpenAI Responses、Anthropic），且可能需要添加新 Provider。如果采用硬编码的 switch-case 模式：
1. 添加新 Provider 需要修改核心代码
2. 测试时难以 mock/替换解析器
3. Provider 之间耦合度高

通过 Parser Registry Pattern：
- 添加新 Provider 只需创建新文件并调用 registerParser
- 测试时可清除 registry 并注册 mock parser
- Provider 解析器完全独立，互不影响

**证据**：
- `parse/openai-chat.ts:214-215` - `registerParser(openaiChatParser);`
- `parse/openai-responses.ts:114-115` - 同样的自注册
- `parse/anthropic.ts:178-179` - 同样的自注册
- `parse/registry.ts` - registerParser 和 getParsers 函数

## 适用范围

- M001.2-Parse (解析器模块)

## 规则

1. **Parser 接口**：所有解析器必须实现 `Parser` 接口（match, parseRequest, parseResponse）
2. **自注册时机**：在模块加载时（import 语句）立即注册
3. **Registry 清理**：提供 `_clearParsersForTesting()` 用于测试隔离
4. **匹配优先级**：registry 按注册顺序遍历，第一个匹配的 parser 被使用

## 反模式 / 禁止项

- ❌ 在 detectAndParse 中硬编码 provider 类型判断
- ❌ 解析器不实现完整的 Parser 接口
- ❌ 在运行时动态注册/注销解析器（可能导致竞态）

## 修改检查清单

- [ ] 新增 Provider 解析器时，创建独立文件并自注册
- [ ] 修改 Parser 接口时，检查所有现有解析器的兼容性
- [ ] 测试新解析器时，使用 `_clearParsersForTesting()` 避免污染
- [ ] 如原则发生变化，已同步更新 SKILL 总览