---
title: Non-invasive Interception
version: 1.0
last_updated: 2026-05-14
type: development-principle
project: opencode-trace
category: Architecture
scope: module-scoped (M003-Plugin)
---

# Non-invasive Interception

## 原则摘要

通过装饰全局 `fetch` 函数实现请求拦截，而不是修改 OpenCode 或 AI Provider 的核心代码。拦截器保存原始 fetch 引用，在追踪完成后恢复。

## 为什么要这样

opencode-trace 作为 OpenCode 插件，无法修改 OpenCode 或 AI Provider 的源码。如果采用侵入式修改：
1. 需要修改依赖的源码，增加维护负担
2. 版本升级时可能失效
3. 无法与其他插件共存

通过全局 fetch 拦截：
- 无需修改任何依赖源码
- OpenCode 升级不影响插件
- 可与其他修改 fetch 的插件共存（需注意顺序）

**证据**：
- `plugin-instance.ts:224-229` - 保存 origFetch，设置拦截器
- `plugin-instance.ts:231-235` - uninstallInterceptor 恢复原始 fetch
- `plugin-instance.ts:25-54` - tracedFetch 调用 origFetch 执行实际请求

## 适用范围

- M003-Plugin (fetch 拦截)

## 规则

1. **保存原始引用**：拦截前保存 `globalThis.fetch` 到 `origFetch`
2. **调用原始 fetch**：拦截器中调用 origFetch 执行实际请求
3. **可恢复设计**：提供 uninstallInterceptor 恢复原始状态
4. **幂等安装**：检查 interceptorInstalled 标志，防止重复安装

## 反模式 / 禁止项

- ❌ 不保存原始 fetch，直接替换导致无法恢复
- ❌ 拦截器中创建新的 fetch 请求（应调用 origFetch）
- ❌ 重复安装拦截器导致嵌套追踪
- ❌ 不提供卸载机制，导致插件卸载后仍有副作用

## 修改检查清单

- [ ] 修改拦截逻辑时，验证 origFetch 调用正确
- [ ] 测试 install/uninstall 循环，验证 fetch 状态恢复
- [ ] 测试与其他 fetch 修改的兼容性
- [ ] 如原则发生变化，已同步更新 SKILL 总览