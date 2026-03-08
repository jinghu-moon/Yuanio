# Source of Truth

## 结论

`seeyue-workflows` 是 workflow 资产的单一来源。

## 同步范围

由 `sync-manifest.json` 显式定义：
- `.agents/skills/sy-*`
- `.claude/settings.json`
- `.claude/sy-hooks.policy.json`
- `scripts/hooks/*`
- `scripts/cleanup-skill-trigger-output.cjs`
- `tests/hooks/*`
- `tests/skill-triggering/*`
- `docs/session-schema.md` -> `docs/workflow/session-schema.md`
- `docs/adoption-guide.md` -> `docs/workflow/adoption-guide.md`
- `docs/source-of-truth.md` -> `docs/workflow/source-of-truth.md`

## 原则

- 不做隐式同步
- 不做自动删除
- 不同步业务代码
- 用 manifest 控制同步边界，避免漂移
