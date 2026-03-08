# Git Hooks

This project provides a lightweight `pre-commit` hook for local Tabler icon validation.

## Install

Run:

```bash
git config core.hooksPath .githooks
```

## What it does

- Runs `bun run check:tabler-icons` before commit.
- Blocks the commit if local `ic_tb_*` drawables diverge from `refer/compose-icons-main`.
