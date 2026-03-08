# Adoption Guide

## 目标

把 `seeyue-workflows` 作为 workflow 单一来源，业务仓库不再直接分散维护 workflow 本体。

## 接入步骤

1. 在业务仓库中引入 `seeyue-workflows`
2. 执行同步命令：
   - `python "seeyue-workflows/scripts/sync-workflow-assets.py" --target-root "."`
3. 确认 hooks 配置已启用
4. 运行最小验证：
   - `node tests/hooks/sy-hooks-smoke.cjs`
   - `node tests/skill-triggering/run-all.cjs --mode local --cases tests/skill-triggering/cases.smoke.json`

## 同步原则

- source of truth 是 `seeyue-workflows`
- 只同步 manifest 中显式声明的资产
- 同步策略是 update-only，不自动删除业务仓库额外文件
- workflow 改动先在 source repo 验证，再同步到业务仓库

## 何时需要同步

- source repo 有新版本
- hooks / skills / tests / docs 中任一 workflow 资产发生变化
- 业务仓库出现 workflow 漂移或回归失败
