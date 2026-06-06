# Changesets

Monorepo 版本管理。每次发版前用 `npx changeset` 声明本次改动，CI 会自动计算版本号并发布。

## 流程

1. 改完代码后，运行 `npx changeset`，按提示：
   - 选受影响的包（空格多选）
   - 选版本类型（major / minor / patch）
   - 写 changelog 描述
2. 这会生成 `.changeset/<random-name>.md`，**连同代码改动一起提交 PR**
3. CI 检查到 `.changeset/*.md` 后会自动开（或更新）一个 `Version Packages` PR
4. 合并 `Version Packages` PR → 自动 publish 到 npm + 创建 GitHub Release

## 不需要写 changeset 的情况

- 内部重构（不暴露给用户的纯内部 API 调整）
- 测试 / 构建 / CI 配置变更
- 文档更新

此时运行 `npx changeset --empty` 生成空 changeset 占位（仅对 PR 检查有用，可选）。

## 命令

```bash
npx changeset              # 交互式添加 changeset
npx changeset status       # 查看当前未发布的 changeset 摘要
npx changeset version      # 本地手动升版（CI 也会做）
npx changeset publish      # 本地手动发布（CI 也会做）
```

## 内部依赖如何处理

`config.json` 中 `updateInternalDependencies: "patch"` — 当 `core` 升版时，依赖 `core` 的 `cli` / `plugin` / `viewer` 的 `@opencode-trace/core` 引用会自动 bump 到新版本号，无需手动改。

## 与本仓库相关的包

- `@opencode-trace/core` — 基础库，cli/plugin/viewer 都依赖它
- `@opencode-trace/cli` — CLI 工具
- `@opencode-trace/plugin` — OpenCode 插件
- `@opencode-trace/viewer` — Web viewer
