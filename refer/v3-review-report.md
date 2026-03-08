# Workflow Skills System Design v3 — 审阅报告
# 审阅日期: 2026-03-06
# 文档版本: v3（含 Patch 1 + Unified TDD merge）

---

## 总体评价

架构主干完整，核心机制（4层约束、3-split执行、4级评审、Task隔离双Pass、BMAD状态追踪、loop budget护栏）设计严密，来源可追溯。补丁集成质量高，变更日志与 Appendix Source Map 对应良好。

发现问题按可阻断性分三级：**P0（立即修正）/ P1（一致性缺陷）/ P2（改进建议）**。

---

## P0 — 阻断性缺陷（5项）

### P0-1 · doc-sync 引用了不存在的脚本

**位置**: §7.5 `doc-sync/SKILL.md` Source Manifest Protocol（Line 1705）

```
RUN !`uv run .claude/scripts/generate-source-manifest.py --path $0`
```

**问题**: §2 文件树 scripts/ 清单只有 5 个脚本：
`update-index / query-index / validate-index / generate-ai-report / validate-ai-report`

`generate-source-manifest.py` **完全缺失**，不在文件树中。

**影响**: `/doc-write` 和 `/doc-update` 在执行 Source Manifest 步骤时会报 FileNotFoundError，流程中断。

**修正方案**:
选一：在 §2 文件树 scripts/ 下补充 `generate-source-manifest.py` 条目，并在 §9 补写实现。
选二：改为内嵌生成（agent 直接输出 source manifest 块，不依赖外部脚本）。

---

### P0-2 · committing 的 phase 检查引用了不存在的 phase 值

**位置**: §7.3 `committing/SKILL.md` Pre-Commit Gate Step 1（Line 1577）

```
IF phase NOT IN ["done", "review", "concerns"]
```

**问题**: `session.yaml` current_phase 枚举（Line 1749）为：
`exploring|benchmarking|free-ideation|designing|plan|execute|review|done`

**`"concerns"` 不是 phase 值**，它是 reviewer 的 Verdict 级别（PASS/CONCERNS/REWORK/FAIL）。

**影响**: 逻辑语义错误。当 verdict 为 CONCERNS 时，session.yaml 的 current_phase 实际仍为 "review"（不会变），用户运行 /commit 时会被错误地阻断或放行。

**修正方案**:
```
IF phase NOT IN ["done", "review"]
```
如需区分 CONCERNS verdict，应读 ledger.md 最后一条 review 记录，而非依赖 phase 字段。

---

### P0-3 · pre-write.py Gate 2 的 YAML 嵌套字段解析脆弱

**位置**: §9 `pre-write.py`（Line 2010-2016）

```python
tdd_required = get_field(content, "tdd_required")
red_verified  = get_field(content, "red_verified")
```

**问题**: `get_field()` 做行级 `startswith` 匹配（去缩进后）。
`tdd_required` 和 `red_verified` 是 `current_node:` 下的**嵌套字段**。

当前实现能工作是因为 `s = line.strip()` 去掉了缩进，但存在两个风险：
1. 若 YAML 其他位置（如 config snapshot）也有同名字段，会误匹配**第一个出现的值**
2. 若字段名重构或 schema 扩展，silent 误读

session.yaml schema v2 中 `config:` 块下没有这两个字段，目前侥幸无误。但属于脆弱实现。

**修正方案**:
使用 `python-yaml` 或 `pyyaml` 解析后按路径读取：
```python
import yaml
data = yaml.safe_load(content)
node = data.get("current_node", {})
tdd_required = str(node.get("tdd_required", "false")).lower()
red_verified  = str(node.get("red_verified",  "false")).lower()
```
scripts/ 已用 UV 单文件格式，可加 `# /// script dependencies = ["pyyaml"] ///`。

---

### P0-4 · benchmarking/ 文件树缺少 references/ 目录

**位置**: §2 文件树 Line 143-145

```
├── benchmarking/                            ← Skill 1b
│   └── SKILL.md
```

**问题**: Patch 1 设计中明确有 `references/gap-matrix-template.md`，且 benchmarking SKILL.md 的 Phase B/C 步骤依赖 gap matrix 结构化格式。文件树中该目录消失。

**与已输出的 benchmarking-SKILL.md 的关系**: 当前输出的 SKILL.md 把 gap matrix 格式内嵌在文件中，可以运转。但 `references/` 目录应补回，以便后续扩展（多参考项目模板、license 查询规则等）。

**修正方案**: 补充文件树：
```
├── benchmarking/
│   ├── SKILL.md
│   └── references/
│       └── gap-matrix-template.md
```

---

### P0-5 · free-ideation/ 文件树缺少 references/ 目录

**位置**: §2 文件树 Line 146-148

```
├── free-ideation/                           ← Skill 1c
│   └── SKILL.md
```

**问题**: Patch 1 设计中有 `references/ideation-canvas.md`，且方向 A/B/C/D 生成逻辑可以引用该模板作为评分框架。

**修正方案**: 补充文件树：
```
├── free-ideation/
│   ├── SKILL.md
│   └── references/
│       └── ideation-canvas.md
```

---

## P1 — 一致性缺陷（5项）

### P1-1 · §6 缺失 4 个入口 skill 的完整 SKILL.md 内容

**位置**: §6 标题声明"Skill Designs — Core (13)"，但实际只覆盖了：
- 6.1 executing-plans ✅
- 6.2 requesting-code-review ✅
- 6.3 workflow/status.md ✅
- 6.4 workflow/start.md ✅
- 6.5 合约级描述（systematic-debugging / verification-before-completion / receiving-code-review / finishing-a-development-branch）⚠️ 有内容但无 frontmatter
- 6.6 ECC derived contracts ✅
- 6.7 Unified TDD Contract ✅

**缺失**（无任何 SKILL.md 内容）：
- `exploring/SKILL.md` — 已由本次会话单独输出，但不在文档正文中
- `benchmarking/SKILL.md` — 同上
- `free-ideation/SKILL.md` — 同上
- `designing/SKILL.md` — 存在于 Patch 1 文档，但未合并进 v3 正文
- `writing-plans/SKILL.md` — §6 完全没有，仅在 §5 planner.md 有侧面信息
- `using-git-worktrees/SKILL.md` — §6 完全没有，仅在 §6.4 start.md 里有引用

**影响**: 文档声称 Core (13)，实际只有 ≈7 个 skill 有完整设计，其余依赖外部文档或会话记忆。

**修正方案**: 补充 §6.8（exploring）/ §6.9（benchmarking）/ §6.10（free-ideation）/ §6.11（designing）/ §6.12（writing-plans）/ §6.13（using-git-worktrees）。

---

### P1-2 · §7 缺失 using-workflow/SKILL.md

**位置**: §7 Auxiliary (5) 标题正确，但内容只有 4 个：
code-insight（7.1）/ read-code.md（7.2）/ committing（7.3）/ tracking-changes（7.4）/ doc-sync（7.5）

`using-workflow` 在文件树（Line 232-233）中存在，但 §7 完全没有对应设计。

**修正方案**: 补充 §7.6 `using-workflow/SKILL.md`（入门指南，列出所有命令及场景）。

---

### P1-3 · /workflow status 的 recommended-next 未覆盖三入口场景

**位置**: §6.3 `workflow/operations/status.md` Step 2（Line 1154-1157）

```
IF session missing or done:
  IF sprint-status.yaml stories remain:
    RECOMMENDED = "/workflow start {next_story.title}"
  ELSE: RECOMMENDED = "/explore (start new feature)"
```

**问题**: 无 session 且无待办 story 时只推荐 `/explore`，忽略了另外两个同级入口。用户可能是"有参考项目"或"无目标"状态。

**修正方案**:
```
IF session missing or done AND no sprint backlog:
  RECOMMENDED =
    "/explore   → 有方向但不够具体\n" +
    "/benchmark → 有参考项目\n" +
    "/free-ideate → 无目标，随便做点什么"
```
输出三选项而非单一推荐。

---

### P1-4 · doc-sync L2 References 引用了不属于自己的 lang 文件

**位置**: §7.5 `doc-sync/SKILL.md` L2 References（Line 1714）

```
| lang/rust.md | lang == "rust" |
```

**问题**: `lang/rust.md` 属于 `code-insight/references/lang/rust.md`，doc-sync 自己的目录结构（§2 Line 219-223）下没有 lang/ 子目录。

**影响**: 路径解析失败，加载条件永远无法满足。

**修正方案**: 改为引用正确路径 `code-insight/references/lang/rust.md`，或在 doc-sync/references/ 下建立符号链接/副本并注明来源。

---

### P1-5 · session.yaml legacy 注释中 exploring 重复出现

**位置**: §8 `session.yaml` Schema（Line 1749）

```yaml
current_phase: execute
  # exploring|benchmarking|free-ideation|designing|plan|execute|review|done
  # (legacy: explore|benchmark|design|brainstorm|ideation)
```

**问题**: `exploring` 同时出现在新值列表和 legacy 列表（`explore` 才是 legacy）。读者无法区分哪个是当前标准值。

**修正方案**:
```yaml
current_phase: execute
  # v3 values: exploring|benchmarking|free-ideation|designing|plan|execute|review|done
  # legacy aliases (accept but normalize): explore→exploring, benchmark→benchmarking,
  #   design→designing, brainstorm→exploring, ideation→free-ideation
```

---

## P2 — 改进建议（3项）

### P2-1 · §6.5 中的 contract 描述缺少 frontmatter

**位置**: §6.5（systematic-debugging / verification-before-completion / receiving-code-review / finishing-a-development-branch）

这四个 skill 有合约级别的行为描述，但没有 frontmatter（name / allowed-tools / description）。不符合 §3 标准。

**建议**: 至少补全 `allowed-tools`，让权限边界在系统层生效而不依赖 prompt。

---

### P2-2 · Appendix Source Map 缺少三入口 skill 的来源标注

**位置**: §Appendix（Line 2394-2431）

exploring / benchmarking / free-ideation 的完整 SKILL.md 设计来自"Patch 1 + v3 会话"，未在 Source Map 中列出。

**建议**:
```
| exploring / benchmarking / free-ideation SKILL.md 完整设计 | v3 Patch 1 + 本次会话 | §6.8-6.10 |
| designing/SKILL.md 完整设计 | v3 Patch 1 | §6.11 |
```

---

### P2-3 · 六段 §6.5 contract 描述中 writing-plans 和 using-git-worktrees 完全缺席

**位置**: §6.5（Line 1226-1286）

systematic-debugging / verification-before-completion / receiving-code-review / finishing-a-development-branch 四个 skill 有 contract 描述。

但 `writing-plans` 和 `using-git-worktrees` 在整个 §6 中**一行设计内容都没有**，只在文件树和路由表里出现。

**建议**: 在 §6.5 补充两个 skill 的 contract block（至少包含 Iron Law / Required Steps / Output）。

---

## 汇总表

| # | 级别 | 位置 | 问题摘要 | 修正难度 |
|---|------|------|---------|---------|
| P0-1 | 🔴 P0 | §7.5 doc-sync | generate-source-manifest.py 不存在 | 中（补脚本或改内嵌） |
| P0-2 | 🔴 P0 | §7.3 committing | "concerns" 不是 phase 值 | 低（改一行） |
| P0-3 | 🔴 P0 | §9 pre-write.py | get_field 嵌套YAML解析脆弱 | 低（改用pyyaml） |
| P0-4 | 🔴 P0 | §2 文件树 | benchmarking/ 缺 references/ | 低（补目录） |
| P0-5 | 🔴 P0 | §2 文件树 | free-ideation/ 缺 references/ | 低（补目录） |
| P1-1 | 🟡 P1 | §6 整体 | 6个 Core skill 无 SKILL.md 内容 | 高（需单独设计） |
| P1-2 | 🟡 P1 | §7 整体 | using-workflow 完全缺失 | 中 |
| P1-3 | 🟡 P1 | §6.3 status.md | recommended-next 只推荐 explore | 低（改输出逻辑） |
| P1-4 | 🟡 P1 | §7.5 doc-sync | lang/rust.md 路径属于 code-insight | 低（修正路径） |
| P1-5 | 🟡 P1 | §8 session.yaml | legacy注释中 exploring 重复 | 低（改注释） |
| P2-1 | 🟢 P2 | §6.5 | 四个skill缺 frontmatter | 低 |
| P2-2 | 🟢 P2 | Appendix | Source Map 缺三入口来源 | 低 |
| P2-3 | 🟢 P2 | §6.5 | writing-plans / worktrees 完全缺席 | 中 |

---

## 优先处理建议

**立即可修（低成本，高价值）**：P0-2 / P0-3 / P0-4 / P0-5 / P1-3 / P1-4 / P1-5 — 合计 7 项，均为单文件改动。

**下一个 Patch（P0-1 + P1-1）**：
- P0-1 决定 doc-sync 能否正常运作，需先确认实现策略（脚本 vs 内嵌）
- P1-1 是文档完整性的主要欠账，建议逐 skill 单独输出后合并进 §6

**长期（P2 系列）**：不阻断运行，在稳定后统一处理。
