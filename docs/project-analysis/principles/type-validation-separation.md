---
project: opencode-trace
type: development-principle
description: "TypeScript interface 定义数据契约，Zod schema 定义运行时验证规则，两者独立维护但必须保持一致。新增字段时 types.ts→schemas→PARSED_CACHE_VERSION 必须同步更新。"
base_commit: 706f29a50cebac416ab271ef1b7f40377171bde1
principle_category: 工程
principle_scope: project-scoped
---

# 类型与验证分离原则

## 原则详细描述

项目采用"类型先行"哲学：TypeScript `interface` 定义数据契约（编译期），Zod `z.object()` 定义运行时验证规则。两者独立维护但必须保持一致——类型定义决定了磁盘上 JSON 文件的结构契约，schema 决定了读取时的验证规则。

新增字段的同步顺序：
1. types.ts 添加字段（使用 `?` 可选修饰符）
2. schemas/ 同步更新 Zod schema
3. 评估 PARSED_CACHE_VERSION 是否需要递增
4. plugin 的本地 TraceRecord 定义同步更新
5. 全项目 `npx tsc --noEmit` 编译检查

## 为什么要这样

- 文件系统是真相来源，interface 必须与 JSON 文件格式严格一致
- Zod schema 在读取时验证，不匹配时返回 null（不 throw）
- 类型与验证分离允许编译期和运行期独立演化，但必须最终一致
- Plugin 包有近重复的 TraceRecord 定义（error 内联而非引用 TraceError），增加了同步负担

## 适用范围

- 所有核心数据类型（TraceRecord, Conversation, Block, Delta, SessionMeta）
- 所有 Zod 验证 schema（schemas/ 模块）
- PARSED_CACHE_VERSION 版本控制（parse/index.ts）

## 规则

- 新增字段使用 `?` 可选修饰符（确保向前兼容旧 JSON 文件）
- 读取时使用 `.safeParse()` 而非 `.parse()`（失败返回 null 而非 throw）
- 修改 Conversation 类型结构时必须递增 PARSED_CACHE_VERSION
- Plugin 的本地 TraceRecord 定义必须与 core/types.ts 保持一致

## 反模式 / 禁止项

- ❌ 修改 types.ts 后不更新 schemas/ Zod schema
- ❌ 修改 parse 输出结构后不递增 PARSED_CACHE_VERSION（会导致 viewer 展示过期缓存数据）
- ❌ 使用 `.parse()` 而非 `.safeParse()`（会在格式不匹配时 throw）
- ❌ 在 Plugin 中定义与 core/types.ts 不一致的 TraceRecord 结构

## 修改检查清单

- [ ] 新增字段是否使用 `?` 可选修饰符
- [ ] schemas/ 的 Zod schema 是否同步更新
- [ ] plugin/src/trace.ts 的本地 TraceRecord 定义是否同步更新
- [ ] PARSED_CACHE_VERSION 是否需要递增
- [ ] 运行 `npx tsc --noEmit` 确保全项目类型兼容
- [ ] 运行 `npm run test` 确保测试通过