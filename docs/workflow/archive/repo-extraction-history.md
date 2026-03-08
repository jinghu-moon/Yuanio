# Repo Extraction History

## 背景

当前仓库最初直接在业务项目中维护 workflow assets。随着 `skills + hooks + tests + docs` 逐步成型，workflow 本体已经具备独立演进价值，因此抽离为独立仓库。

## 抽离决策

保留在独立仓库中的资产：

- `.agents/skills/sy-*`
- `.claude/settings.json`
- `.claude/sy-hooks.policy.json`
- `scripts/hooks/*`
- `tests/hooks/*`
- `tests/skill-triggering/*`
- workflow 相关 README / schema / adoption docs

## 命名历史

- 初始草案名：`seeyur-workflows`
- 最终采用名：`seeyue-workflows`
- 当前仓库中的同步脚本、文档引用和 package 名称都已切换到 `seeyue-workflows`

## 当前策略

- `seeyue-workflows` 是 workflow 单一来源
- 当前仓库通过同步脚本接收 workflow 更新
- 业务仓库不再作为 workflow 本体的主编辑位置
