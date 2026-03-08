# Workflow Skills System Design v3 — Patch 2
# Date: 2026-03-06
# Fixes: 13 items from review report (5×P0 + 5×P1 + 3×P2)
# Apply on top of: workflow-skills-system-design-v3.md (MD5: 9ee549e2586c71c8a70d6e314a4abe2c)

---

## 修正项总览

| ID | 级别 | 位置 | 摘要 |
|----|------|------|------|
| P0-1 | 🔴 | §2 + §9 | generate-source-manifest.py 不存在 → 补文件树 + 脚本实现 |
| P0-2 | 🔴 | §7.3 | "concerns" 不是 phase 值 → 修正 Pre-Commit Gate |
| P0-3 | 🔴 | §9 pre-write.py | get_field 嵌套解析脆弱 → 改用 pyyaml |
| P0-4 | 🔴 | §2 | benchmarking/ 缺 references/ → 补目录 |
| P0-5 | 🔴 | §2 | free-ideation/ 缺 references/ → 补目录 |
| P1-1 | 🟡 | §6 | 6 个 Core skill 缺完整 SKILL.md → 补 §6.8–§6.13 |
| P1-2 | 🟡 | §7 | using-workflow/SKILL.md 完全缺失 → 补 §7.6 |
| P1-3 | 🟡 | §6.3 | recommended-next 无 session 时只推荐 /explore → 改为三选项 |
| P1-4 | 🟡 | §7.5 | doc-sync lang/rust.md 路径错误 → 修正 |
| P1-5 | 🟡 | §8 | session.yaml legacy 注释中 exploring 重复 → 修正 |
| P2-1 | 🟢 | §6.5 | 四个 skill 缺 frontmatter → 补全 |
| P2-2 | 🟢 | Appendix | Source Map 缺三入口来源 → 补行 |
| P2-3 | 🟢 | §6.5 | writing-plans / using-git-worktrees 完全缺席 → 补 contract |

---

# §2 File Tree — 三处变更

## P0-4 / P0-5: 补 references/ 目录

REPLACE:
```
│       ├── benchmarking/                            ← Skill 1b
│       │   └── SKILL.md                             ← allowed-tools: [Read,WebSearch]
│       │
│       ├── free-ideation/                           ← Skill 1c
│       │   └── SKILL.md                             ← allowed-tools: [Read,WebSearch]
```

WITH:
```
│       ├── benchmarking/                            ← Skill 1b
│       │   ├── SKILL.md                             ← allowed-tools: [Read,WebSearch]
│       │   └── references/
│       │       └── gap-matrix-template.md
│       │
│       ├── free-ideation/                           ← Skill 1c
│       │   ├── SKILL.md                             ← allowed-tools: [Read,WebSearch]
│       │   └── references/
│       │       └── ideation-canvas.md
```

## P0-1: 补 generate-source-manifest.py

REPLACE:
```
│   ├── scripts/                                     ← UV 单文件，跨平台
│   │   ├── update-index.py                          ← 扫描项目 → .ai/index.json
│   │   ├── query-index.py                           ← !command 注入点
│   │   ├── validate-index.py                        ← schema + 业务规则验证
│   │   ├── generate-ai-report.py                    ← ai.report.json + ai.report.md
│   │   └── validate-ai-report.py                    ← report schema 验证
```

WITH:
```
│   ├── scripts/                                     ← UV 单文件，跨平台
│   │   ├── update-index.py                          ← 扫描项目 → .ai/index.json
│   │   ├── query-index.py                           ← !command 注入点
│   │   ├── validate-index.py                        ← schema + 业务规则验证
│   │   ├── generate-ai-report.py                    ← ai.report.json + ai.report.md
│   │   ├── validate-ai-report.py                    ← report schema 验证
│   │   └── generate-source-manifest.py              ← README.AI.md Source Manifest 生成
```

---

# §6 Skill Designs — Core (13)

## P1-3: §6.3 status.md — recommended-next 三入口修正

REPLACE（§6.3 Step 2 末段）:
```
  IF session missing or done:
    IF sprint-status.yaml stories remain:
      RECOMMENDED = "/workflow start {next_story.title}"
    ELSE: RECOMMENDED = "/explore (start new feature)"
```

WITH:
```
  IF session missing or done:
    IF sprint-status.yaml stories remain:
      RECOMMENDED = "/workflow start {next_story.title}"
    ELSE:
      RECOMMENDED =
        "新功能？选择入口：\n" +
        "  /explore <想法>     → 有方向但不够具体\n" +
        "  /benchmark <url>    → 有参考项目\n" +
        "  /free-ideate        → 无目标，随便做点什么"
```

---

## P2-1 + P2-3: §6.5 四个 skill 补 frontmatter，补 writing-plans / using-git-worktrees contract

REPLACE 整个 `## 6.5 Superpowers-Derived Operational Contracts` 块（从标题到 ``` 结尾）:

```markdown
## 6.5 Superpowers-Derived Operational Contracts

```markdown
---
name: systematic-debugging
description: "Root-cause-first debugging discipline. Use when a bug needs investigation
  before fixing. Enforces 4-phase order: evidence → pattern → hypothesis → implement.
  Triggers: /debug, 调试, 找 bug, 报错了.
  Usage: /debug"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

### systematic-debugging/SKILL.md

Iron Law:
  NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST

Required phase order:
  1) root-cause evidence
  2) pattern comparison
  3) single-hypothesis test
  4) implementation + verification

Escalation:
  IF 3 fix attempts failed:
    - STOP incremental patching
    - question architecture/fundamental pattern
    - discuss with user before fix #4
```

```markdown
---
name: verification-before-completion
description: "Gate function before any success or completion claim. Enforces fresh
  command evidence before claiming pass/complete/fixed.
  Triggers: /verify, 验证完成, 确认通过.
  Usage: /verify"
allowed-tools:
  - Read
  - Bash
  - Glob
---

### verification-before-completion/SKILL.md

Gate Function before any success/completion claim:
  1. IDENTIFY proving command
  2. RUN full command (fresh)
  3. READ full output + exit code
  4. VERIFY claim is supported
  5. ONLY THEN claim success

For config/env/provider/flag changes:
  MUST verify intent-delta evidence (response field/log/behavior change),
  not only status success.
```

```markdown
---
name: receiving-code-review
description: "Processes incoming code review feedback with verify-first discipline.
  Clarifies before implementing. One item at a time.
  Triggers: /review-feedback $0, 处理评审意见.
  Usage: /review-feedback N3"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

### receiving-code-review/SKILL.md

Feedback handling rules:
  - clarify ALL unclear items before implementing ANY item
  - implement one item at a time with per-item verification
  - external reviewer feedback = suggestions to validate, not blind orders
  - no performative agreement language; action + evidence first
```

```markdown
---
name: finishing-a-development-branch
description: "Completes a development branch: verify suite, then present 4 options
  (merge/push+PR/keep/discard). Handles worktree cleanup per sandbox_mode.
  Triggers: /finish-branch.
  Usage: /finish-branch"
allowed-tools:
  - Bash(git:*)
---

### finishing-a-development-branch/SKILL.md

Completion protocol:
  1. Verify full test suite before presenting options
  2. Present exactly 4 options:
     (merge locally / push+PR / keep as-is / discard)
  3. For discard:
     - show deletion impact
     - require exact typed confirmation token
  4. Worktree cleanup policy (Patch 1):
     - cleanup on merge/discard paths (if sandbox_mode=true)
     - preserve worktree for keep-as-is path
```

```markdown
---
name: writing-plans
description: "Creates a structured node-table plan from an approved design.
  Loads Planner persona. Assigns TDD markers, verify commands, and dependencies.
  MUST NOT write source files. Awaits user approval before /execute.
  Triggers: /plan $0, 制定计划, 拆分任务.
  Usage: /plan \"add dry-run mode\""
allowed-tools:
  - Read
  - Glob
  - WebSearch
---

### writing-plans/SKILL.md

## Step 0 — Load Planner Persona
LOAD references/personas/planner.md

## Step 1 — Input Validation
  READ session.yaml → current_phase
  IF current_phase != "designing" AND require_design_approval == true:
    OUTPUT "⚠️ No approved design found. Run /design first."
    EXIT.
  READ .ai/workflow/design-decisions.md (if exists) → component map + tech decisions
  READ .ai/init-report.md (if exists) → language stack + project context

## Step 2 — Scope Gate
  DECLARE: In Scope / Out of Scope / Deferred
  MUST NOT silently include out-of-scope items.
  Deferred items MUST be listed explicitly.

## Step 3 — Node Table Construction
  For each in-scope work item:
    ASSIGN: id / target / action / verify_cmd
    IF behavior change or bug fix: ASSIGN red_cmd / green_cmd / tdd_required=true
    IF API uncertain: ADD research node before implementation node
    IF parallel-safe: ASSIGN parallel_group
  FOLLOW node table schema in planner.md.

## Step 4 — Risk Assessment
  List top 3 risks: High → Med → Low, each with mitigation.

## Step 5 — Output + Approval Gate
  EMIT plan per planner.md Output Contract.
  WRITE session.yaml → current_phase = "plan", next_action = "/execute"
  OUTPUT "⏸ Awaiting approval. Reply /execute to proceed."
  MUST NOT auto-proceed. MUST await explicit user approval.
```

```markdown
---
name: using-git-worktrees
description: "Creates and manages git worktrees for isolated development environments.
  Auto-triggered by /workflow start when sandbox_mode=true. Manual override available.
  Triggers: /worktree $0, /worktree --off, /worktree --on, /worktree --status.
  Usage: /worktree feature/my-task
         /worktree --off"
allowed-tools:
  - Bash(git:*)
---

### using-git-worktrees/SKILL.md

## Trigger Modes

| Trigger | Mode | Behavior |
|---------|------|----------|
| /workflow start (sandbox=true) | Auto | Create worktree, write session.yaml |
| /worktree $0 | Manual | Create named worktree |
| /worktree --off | Override | Disable sandbox for this session |
| /worktree --on | Override | Re-enable sandbox for this session |
| /worktree --status | Info | Show active worktrees |

## Auto Mode (from /workflow start)

BRANCH_NAME = slugify(session.task):
  lowercase, spaces→hyphens, strip special chars
  PREFIX: "feature/" if new feature, "fix/" if bug fix

PRE-CREATION CHECK:
  RUN: git check-ignore .worktrees/
  IF not ignored: add .worktrees/ to .gitignore, commit before proceeding.

RUN: git worktree add .worktrees/{branch_name} -b {branch_name}

ON SUCCESS:
  RUN project setup + baseline tests.
  IF baseline fails: STOP and ask "Proceed with known-red baseline? [yes/no]"
  WRITE session.yaml:
    config.sandbox_actual_branch: {branch_name}
    config.sandbox_worktree_path: ".worktrees/{branch_name}"

ON FAILURE (branch exists):
  SUGGEST: git worktree add .worktrees/{branch_name}-2 {branch_name}
  AWAIT user decision.

## Override: --off
  WRITE session.yaml → config.sandbox_mode = false
  OUTPUT "⚠️ Sandbox disabled for this session. Branch: $(git branch --show-current)"

## Override: --on
  IF no prior worktree_path: run Auto Mode.
  ELSE: switch to existing path.

## Cleanup (called by /finish-branch on merge/discard paths)
  RUN: git worktree remove .worktrees/{branch_name}
  RUN: git branch -d {branch_name}  # only if merged
  WRITE session.yaml → config.sandbox_worktree_path = null
```
```

---

## P1-1: §6.8–§6.13 — 六个缺失 Core Skill 完整 SKILL.md

INSERT 在 `## 6.7 Unified TDD Contract` 之后、`---` 分隔线之前:

---

### §6.8 `exploring/SKILL.md`

```markdown
---
name: exploring
description: "Clarifies a vague or half-formed idea through structured Socratic
  questioning. Produces a concrete Problem Statement ready for /designing.
  Triggers: /explore $0, 有想法, 探索一下, 我在想.
  Usage: /explore \"想做一个重定向引擎\""
allowed-tools:
  - Read
  - WebSearch
---

# Exploring

将半成型想法转化为清晰的问题陈述（Problem Statement）。
输出汇入 `/designing`。与 benchmarking / free-ideation 同级。

## Precondition

- `$0` 必须存在。IF 空 → ABORT: `用法: /explore <想法>`
- IF session.current_phase 不为空 AND != "done":
  OUTPUT "⚠️ 当前有未完成工作流 (phase={phase})。继续？[yes / no]"
  IF no → ABORT.

## Constraints (RFC 2119)

1. MUST 每轮只问一个问题。MUST 等待回答后再进入下一轮。
2. MUST NOT 在提问阶段提出解决方案或技术选型。
3. MUST 在问题清晰时提前停止。最多 5 轮。
4. MUST NOT 仅凭 $0 直接生成问题陈述。至少需要一轮回答。
5. 问题陈述 MUST 包含非空「超出范围」字段。
6. IF 想法不可行 → MUST 明确指出，MUST NOT 静默继续。
7. MUST NOT 在用户明确 yes 前路由 /designing。

## Steps

Step 0: OUTPUT `🚀 使用 exploring 梳理: $0`
Step 1: LOAD references/question-templates.md
Step 2: 苏格拉底式提问（max 5 轮，提前清晰则停止）

| 轮次 | 焦点 |
|------|------|
| 1 | 这解决什么问题？谁有这个问题？ |
| 2 | "完成"是什么样子？怎么验证有效？ |
| 3 | 硬性约束？（技术栈/时间/规模）|
| 4 | 已有类似方案？为什么不直接用？|
| 5 | 最大的未验证假设是什么？|

Step 3: 综合为问题陈述（见 Output）
Step 4: 呈现，等待 [yes / 继续完善]
  IF yes: WRITE session.yaml (schema 2) → task / current_phase="exploring" / next_action="/designing"

## Output

```
📋 问题陈述
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
问题:     {一句话，动词开头}
用户:     {谁有这个问题}
完成标准: {可量化的验收条件}
约束:     {技术栈/时间/规模}
假设:     {最高风险 2-3 条，标注「未验证」}
超出范围: {明确排除的内容}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 开始架构设计？[yes / 继续完善]
```

## Checklist
- [ ] 至少一轮问答后才合成陈述
- [ ] 提问阶段无方案/架构提议
- [ ] 「超出范围」非空
- [ ] 用户明确 yes 后才路由
- [ ] session.yaml 已写入

## Red Flags
- "直接开始设计吧" 问题未确认 → STOP
- 「超出范围」为空 → 不完整，重新生成
- 路由目标写成 /design 而非 /designing → 路径错误
```

---

### §6.9 `benchmarking/SKILL.md`

```markdown
---
name: benchmarking
description: "Analyzes a reference project to produce a gap matrix and design decisions
  ready for /designing. Use when you have a reference project as design input.
  Triggers: /benchmark $0, 对标, 参考项目, 类似 X 的项目.
  Usage: /benchmark https://github.com/obra/superpowers
         /benchmark \"Notion-like editor\""
allowed-tools:
  - Read
  - WebSearch
---

# Benchmarking

分析参考项目 → 差距矩阵 + 取舍决策。
输出汇入 `/designing`。与 exploring / free-ideation 同级。

## Precondition

- `$0` 必须存在。IF 空 → ABORT: `用法: /benchmark <url|名称>`
- IF 参考项目不可访问 → ABORT: `无法访问 {$0}，请提供可访问链接或描述功能列表`
  MUST NOT 凭空发明功能列表。
- IF session.current_phase 不为空 AND != "done": 询问确认。

## Constraints (RFC 2119)

1. MUST 按顺序完成 Analyze → Compare → Decide。MUST NOT 跳过 Compare。
2. License 门控: MUST 在任何 Adopt/Adapt 行之前检查 license。
   IF 限制性 license → Decision MUST 为 `Skip (license)`。
3. Decision 列 MUST 只用: `Adopt / Adapt / Skip / Skip (license) / Redesign / Defer`。
4. `Redesign` 行 MUST 含缺陷描述 + 替代方案。
5. `Defer` 行 MUST 含触发条件。
6. MUST NOT 隐式继承参考架构，无 Adopt/Adapt 行则不得沿用。
7. Output MUST 含非空「核心洞察」段落。
8. MUST NOT 在用户 yes 前路由 /designing。

## Steps

Step 0: OUTPUT `🚀 使用 benchmarking 分析: $0`
Step 1: 参考项目解析（URL fetch 或名称搜索，记录 license）
Step 2: Phase A — Analyze（功能列表/架构/技术栈/设计哲学/已知痛点）
Step 3: Phase B — Compare（READ .ai/init-report.md 加载项目上下文，构建差距矩阵）
Step 4: Phase C — Decide（逐行 Adopt/Adapt/Skip/Redesign/Defer）
Step 5: 综合核心洞察
Step 6: 呈现报告，等待 [yes / 分析另一个]
  IF yes: WRITE session.yaml → task / current_phase="benchmarking" / next_action="/designing"
         APPEND ledger.md → benchmarking 摘要

## Gap Matrix Format

| 功能/模式 | 参考项目 | 你的目标 | Decision | Rationale |
|-----------|---------|---------|----------|-----------|
| {条目} | ✅ 有 | ❌ 缺 | Adopt/Adapt/Skip/Skip(license)/Redesign/Defer | {原因} |

## Output

```
📊 对标报告: {reference_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
参考项目:  {名称} | License: {类型} | 架构: {pattern}
技术栈:    {stack} | 分析日期: {today}

差距矩阵:
{gap matrix table}

设计决策:
  ✅ Adopt:          {列表}
  🔄 Adapt:          {列表 — 含 delta}
  ⏭ Skip:           {列表 — 含原因}
  🚫 Skip (license): {列表}
  🔨 Redesign:       {列表 — 含缺陷+替代}
  ⏳ Defer:          {列表 — 含触发条件}

核心洞察: {一段话 — 改变你设计方向的关键点}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 开始架构设计？[yes / 分析另一个]
```

## Checklist
- [ ] 参考项目可访问，功能列表非发明
- [ ] License 在任何 Adopt/Adapt 前已检查
- [ ] 三阶段按序完成
- [ ] 每个 Redesign 行含缺陷+替代
- [ ] 每个 Defer 行含触发条件
- [ ] 核心洞察非空且非 gap matrix 重述
- [ ] session.yaml + ledger.md 已写入

## Red Flags
- 无 Adopt 行但架构直接沿用 → 隐式借用，违规
- Redesign 无 rationale → 无效
- License 未检查即出现 Adopt → STOP
- 路由目标写成 /design 而非 /designing → 路径错误
```

---

### §6.10 `free-ideation/SKILL.md`

```markdown
---
name: free-ideation
description: "Open-ended idea generation with no fixed goal. Generates and scores
  7 candidate ideas. Selected idea routes to /explore then /designing.
  Triggers: /free-ideate, 没有目标, 随便做点什么, 有空, 构思一下.
  Usage: /free-ideate"
allowed-tools:
  - Read
  - WebSearch
---

# Free Ideation

从零发散 → 7 个评分候选想法 → 选定一个进入 /exploring。
输出通过 /exploring 汇入 /designing。

## Precondition

- 无需 $0。
- IF 用户已有具体想法 → 建议 /explore，ABORT。
- IF 用户已有参考项目 → 建议 /benchmark，ABORT。
- IF .ai/index.json 存在 → READ，推断用户域（供方向 D 使用）。

## Constraints (RFC 2119)

1. MUST 生成前先询问方向偏好（Step 1）。MUST NOT 跳过。
2. MUST 生成恰好 7 个想法（5 定向 + 2 野卡）。不多不少。
3. 每个想法 MUST 在全部三轴（F/I/V）评分。缺轴无效。
4. MUST NOT 将总分 < 8/15 的想法主推。
5. 想法描述 MUST 停在问题层面。MUST NOT 含实现细节。
6. 用户选定后 MUST 路由 /explore（除非想法已足够具体，需明确告知）。
7. MUST NOT 在用户选择或 [q] 退出前自动推进。

## Steps

Step 0: OUTPUT `🚀 使用 free-ideation 发现值得做的事`

Step 1: 询问方向（一问，等待回答）:
```
🔵 方向偏好？
   A. 解决自己的痛点
   B. 技术探索（想试某个技术栈）
   C. 复刻/改进已有工具
   D. 完全随机
```
IF 用户跳过 → 按 D 处理。

Step 2: 按方向生成想法:
| 方向 | 方法 |
|------|------|
| A | 追问: "最近遇到什么重复性麻烦事？" → How Might We 框架 → 5 个 |
| B | 追问: "想探索哪个技术方向？" → SEARCH "{tech} projects 2026" → 5 个 |
| C | 追问: "哪个工具可以做得更好？" → 轻量 benchmarking → 5 个改进变体 |
| D | READ .ai/index.json → 推断领域 → 5 个 + 2 野卡 |
各方向补 2 个跨领域野卡（D 方向已内含）。

Step 3: 三轴评分（1–5）:
| 轴 | 问题 |
|----|------|
| F（可行） | 合理时间内可做出来？ |
| I（兴趣） | 做这个有多大动力？ |
| V（价值） | 至少对一个真实用户有用？ |
按总分 DESC 排序。

Step 4: 呈现排名列表（见 Output），等待选择。

Step 5: 路由:
  IF [n] 选定:
    IF 想法需要梳理 → WRITE session.yaml，路由 /explore "{idea}"
    IF 已足够具体  → 告知用户，WRITE session.yaml，路由 /designing
  IF [r] → 返回 Step 1
  IF [q] → EXIT

## Output

```
💡 构思结果
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#1. {标题}  (F:{n} I:{n} V:{n} = {total}/15)
    {一句话 — 问题层面，无实现细节}
    技术方向: {建议栈}  最大风险: {最大未知}
...
#7. {标题}  (F:{n} I:{n} V:{n} = {total}/15)  ← 野卡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 选择一个继续:
   [1–7] → /explore 深入梳理
   [r]   → 换方向重新生成
   [q]   → 先不做，我再想想
```

## Checklist
- [ ] 方向偏好询问在生成前完成
- [ ] 恰好 7 个想法（5+2 野卡）
- [ ] 三轴评分均完整
- [ ] 无总分 < 8 的主推
- [ ] 描述在问题层面（无实现细节）
- [ ] 路由前 session.yaml 已写入

## Red Flags
- 少于 7 个想法 → 补足再呈现
- 描述含实现细节 → 改为问题层面
- 跳过 /explore 直接到 /designing（想法不够具体时）→ STOP
- 路由目标写成 /design 而非 /designing → 路径错误
```

---

### §6.11 `designing/SKILL.md`

```markdown
---
name: designing
description: "Translates problem statements, benchmark reports, or idea selections
  into approved technical architecture. Convergence point for all three entry skills.
  Triggers: /design $0. MUST NOT proceed to /plan without explicit user approval.
  Usage: /design"
allowed-tools:
  - Read
  - WebSearch
---

# Designing

三入口汇聚点：exploring / benchmarking / free-ideation 的产物 → 技术架构决策 → 用户批准 → /plan。

## Precondition

- READ session.yaml → current_phase
  IF current_phase NOT IN ["exploring", "benchmarking", "free-ideation"]:
    IF current_phase == "done" OR current_phase == "":
      OUTPUT "⚠️ 没有检测到入口 skill 的输出。请先运行 /explore / /benchmark / /free-ideate。"
      AWAIT user response（可提供文字描述绕过门控）。
  IF current_phase IN ["plan","execute","review"]:
    OUTPUT "⚠️ 当前工作流处于 {phase}，再次运行 /design 将创建新设计。确认？[yes / no]"
    IF no → ABORT.

## Constraints (RFC 2119)

1. MUST 检测输入来源（exploring/benchmarking/free-ideation），按来源调整架构重点。
2. Component Map MUST 为每个组件分配 role / interface / constraints 三项。
3. Tech Stack Decisions MUST 记录：选择 / 备选 / 选择理由。
   IF stack 已在 .ai/init-report.md 检测到：确认或显式覆盖，不得静默继承。
4. Non-Goals 节 MUST 明确列出（不得为空）。
5. MUST NOT 在用户明确批准前调用 /plan 或写入计划文件。
6. 用户批准后：MUST 写入 design-decisions.md + 更新 session.yaml。

## Steps

Step 0: OUTPUT `🚀 使用 designing 创建技术架构`
Step 1: 输入来源检测
  IF exploring 输出（问题陈述存在）→ MODE = from-exploring
  IF benchmarking 输出（gap matrix 存在）→ MODE = from-benchmarking
  IF free-ideation 输出（想法列表存在）→ MODE = from-free-ideation
  IF 无输出 → 请用户描述目标（一段话）

Step 2: 架构设计（所有节必须存在）
  - Component Map（组件 / 职责 / interface inputs + outputs / constraints）
  - Tech Stack Decisions（选择 / 备选 / 理由）
  - Data Model（关键实体 + 关系，不定义完整 schema）
  - Integration Points（外部依赖 / API / 格式 / 协议）
  - Non-Goals（明确排除项）

Step 3: 风险评估
  Top 3 risks: Likelihood(High/Med/Low) + Mitigation

Step 4: 用户批准门控
  EMIT design output（见 Output）
  AWAIT [yes / revise / scope]
  IF yes:
    WRITE .ai/workflow/design-decisions.md (append-only)
    WRITE session.yaml → current_phase="designing" / next_action="/plan"
    OUTPUT "设计已批准。运行 /plan 创建实现节点。"
  IF revise → 按用户要求修改后重新呈现
  IF scope  → 调整范围后重新呈现

## Output

```
📐 技术设计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Component Map]
[Tech Stack Decisions]
[Data Model]
[Integration Points]
[Non-Goals]
[Risks]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 批准设计？[yes / revise / scope]
```

## Checklist
- [ ] 输入来源已检测
- [ ] 所有架构节均存在（含 Non-Goals）
- [ ] Tech Stack 选择有备选和理由
- [ ] 用户明确批准后才调用 /plan
- [ ] design-decisions.md + session.yaml 已写入
```

---

# §7 Skill Designs — Auxiliary (5)

## P1-2: §7.6 — using-workflow/SKILL.md（新增）

INSERT 在 `## 7.5 doc-sync/SKILL.md` 之后:

```markdown
## 7.6 `using-workflow/SKILL.md`

```markdown
---
name: using-workflow
description: "Workflow help and command reference. Shows available commands, current
  state, and how to get started. Use when confused about next step or available commands.
  Triggers: /help, 怎么用, 有哪些命令, 下一步是什么.
  Usage: /help"
allowed-tools:
  - Read
---

# Using Workflow

## Purpose
新用户入门或任何时候需要帮助时加载的参考手册。
Read-only，不修改任何状态。

## Step 0 — Announce
OUTPUT: `🚀 使用 using-workflow 显示命令参考`

## Step 1 — 读取当前状态
READ .ai/workflow/session.yaml (if exists) → current_phase, next_action
IF session exists AND current_phase != "done" AND current_phase != "":
  OUTPUT "当前状态: phase={phase}, 建议下一步: {next_action}"

## Step 2 — 命令参考输出

OUTPUT:
```
📖 WORKFLOW 命令参考
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【入口 — 三选一，同级】
  /explore <想法>      有方向但不够具体
  /benchmark <url>     有参考项目
  /free-ideate         无目标，随便做点什么

【主链】
  /design              架构设计（三入口汇聚点）
  /worktree [--on|--off] git worktree 沙箱管理
  /plan <任务>         制定节点计划
  /tdd                 TDD 约束加载
  /execute [node|test|verify] [$id]  分阶段执行节点
  /debug               调试（先根因后修复）
  /verify              完成前验证
  /review              代码审查（4 级评审）
  /review-feedback $n  处理评审反馈
  /changelog           记录变更
  /commit              提交（用户触发）
  /finish-branch       分支收尾

【工作流管理】
  /workflow start <任务>   启动新 session
  /workflow continue       恢复中断 session
  /workflow status         查看状态 + 下一步推荐
  /help                    本帮助

【代码洞察（辅助）】
  /init [--deep]           建立项目索引
  /analyze <path>          分析模块
  /understand <path>       理解文件
  /doc-write <path>        生成 README.AI.md
  /doc-update <path>       更新 README.AI.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 新项目推荐流程:
   /init → /explore → /design → /plan → /execute ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
```
```

## P1-4: §7.5 doc-sync — Source Manifest 和 L2 References 修正

REPLACE（§7.5 Source Manifest Protocol + L2 References）:
```
## Source Manifest Protocol

EVERY README.AI.md MUST end with Source Manifest:
  RUN !`uv run .claude/scripts/generate-source-manifest.py --path $0`
  APPEND output to README.AI.md

## L2 References

| File | Load Condition |
|------|----------------|
| references/readme-template.md | /doc-write Step 6 |
| references/writing-style.md | Both, final step |
| lang/rust.md | lang == "rust" |
```

WITH:
```
## Source Manifest Protocol

EVERY README.AI.md MUST end with Source Manifest:
  RUN !`uv run .claude/scripts/generate-source-manifest.py --path $0`
  APPEND output to README.AI.md
  IF script missing: agent MUST inline-generate manifest block using:
    - file path list from Read tool
    - timestamps from stat
    - Format: "<!-- Source: {path} | {mtime} -->" per file

## L2 References

| File | Load Condition |
|------|----------------|
| references/readme-template.md | /doc-write Step 6 |
| references/writing-style.md | Both, final step |
| .claude/skills/code-insight/references/lang/rust.md | lang == "rust" |
| .claude/skills/code-insight/references/lang/vue.md | lang == "vue" |
| .claude/skills/code-insight/references/lang/ts.md | lang == "typescript" |
```

---

# §7.3 committing — P0-2 修正

REPLACE:
```
STEP 1 — Session check:
  READ session.yaml → current_phase
  IF phase NOT IN ["done", "review", "concerns"]:
    OUTPUT "⚠️ Workflow at phase '{phase}'. Commit before review complete?"
    🔵 USER DECISION REQUIRED
    Options: [yes, continue / no, abort]
    AWAIT response. IF no → EXIT.
```

WITH:
```
STEP 1 — Session check:
  READ session.yaml → current_phase
  IF phase NOT IN ["done", "review"]:
    OUTPUT "⚠️ Workflow at phase '{phase}'. Commit before review complete?"
    🔵 USER DECISION REQUIRED
    Options: [yes, continue / no, abort]
    AWAIT response. IF no → EXIT.
  NOTE: CONCERNS is a reviewer verdict, not a phase value.
        When verdict=CONCERNS, phase remains "review" in session.yaml.
```

---

# §8 Context Continuity — P1-5 修正

REPLACE（session.yaml Schema current_phase 注释行）:
```
current_phase: execute   # exploring|benchmarking|free-ideation|designing|plan|execute|review|done (legacy: explore|benchmark|design|brainstorm|ideation)
```

WITH:
```
current_phase: execute
  # v3 values:  exploring | benchmarking | free-ideation | designing | plan | execute | review | done
  # legacy aliases (accept, normalize on write):
  #   explore    → exploring
  #   benchmark  → benchmarking
  #   design     → designing
  #   brainstorm → exploring
  #   ideation   → free-ideation
```

---

# §9 Hooks & Scripts — P0-1 / P0-3 修正

## P0-3: pre-write.py Gate 2 — 改用 pyyaml

REPLACE 整个 `## pre-write.py` 代码块:

```python
#!/usr/bin/env python3
# /// script
# dependencies = ["pyyaml"]
# ///
# TRIGGER: PreToolUse → Write|Edit
# EXIT: 0=allow  2=block (stdout → Claude context)

import json, sys, os, re

try:
    input_data = json.loads(sys.stdin.read())
except json.JSONDecodeError:
    sys.exit(0)

file_path = (
    os.environ.get("CLAUDE_TOOL_INPUT_FILE_PATH")
    or input_data.get("tool_input", {}).get("file_path", "")
)
project = os.environ.get("CLAUDE_PROJECT_DIR", ".")

# Gate 1: Protected files
PROTECTED = [
    (r"\.env$", "root .env"), (r"\.env\.", ".env.* variant"),
    (r"Cargo\.lock$", "Cargo.lock"), (r"package-lock\.json$", "package-lock.json"),
    (r"pnpm-lock\.yaml$", "pnpm-lock.yaml"),
]
for pattern, label in PROTECTED:
    if re.search(pattern, file_path):
        print(f"PROTECTED FILE BLOCKED: {file_path} ({label}). Do not write directly.")
        sys.exit(2)

# Gate 2: TDD red gate — pyyaml for safe nested field access (P0-3 fix)
session_path = os.path.join(project, ".ai/workflow/session.yaml")
if os.path.exists(session_path):
    try:
        import yaml
        with open(session_path) as f:
            data = yaml.safe_load(f) or {}
        phase = data.get("current_phase", "")
        if phase == "execute":
            node = data.get("current_node", {})
            tdd_required = str(node.get("tdd_required", False)).lower()
            red_verified  = str(node.get("red_verified",  False)).lower()
            if tdd_required == "true" and red_verified == "false":
                is_test = any(x in file_path for x in ["test", "spec", "_test", "__test__"])
                if not is_test:
                    node_id = node.get("id", "?")
                    print(f"TDD GATE BLOCKED: current_node({node_id}).tdd_required=true but red_verified=false.")
                    print(f"Run /execute test {node_id} first to confirm red state.")
                    sys.exit(2)
    except Exception as e:
        # Parse failure → warn but do not block (fail-open for gate 2)
        print(f"WARNING: pre-write.py Gate 2 parse error: {e}", file=sys.stderr)

# Gate 3: ledger.md overwrite protection (append-only enforcement)
ledger_path = os.path.realpath(os.path.join(project, ".ai/workflow/ledger.md"))
if os.path.exists(file_path) and os.path.realpath(file_path) == ledger_path:
    new_content = input_data.get("tool_input", {}).get("content", "")
    existing = open(ledger_path).read()
    if new_content and not new_content.startswith(existing[:min(100, len(existing))]):
        print("LEDGER PROTECTION: ledger.md is append-only. Do NOT overwrite.")
        print("Append new entries to the END of the file only.")
        sys.exit(2)

print(json.dumps({"decision": "approve"}))
sys.exit(0)
```

## P0-1: generate-source-manifest.py（新增脚本）

INSERT 在 `## stop.py` 之后、`---` 分隔线之前:

```python
## `generate-source-manifest.py`

```python
#!/usr/bin/env python3
# /// script
# dependencies = []
# ///
# TRIGGER: uv run .claude/scripts/generate-source-manifest.py --path <dir>
# PURPOSE: Generate Source Manifest block for README.AI.md
# OUTPUT:  Markdown block with file paths, sizes, and mtimes

import os, sys, argparse, time

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", required=True, help="Target directory or file path")
    args = parser.parse_args()

    target = args.path
    project = os.environ.get("CLAUDE_PROJECT_DIR", ".")

    # Resolve target relative to project
    if not os.path.isabs(target):
        target = os.path.join(project, target)

    # Collect source files
    entries = []
    IGNORE_PATTERNS = ["__pycache__", "node_modules", ".git", "dist", "target", "*.lock"]

    def should_ignore(name):
        import fnmatch
        return any(fnmatch.fnmatch(name, p) for p in IGNORE_PATTERNS)

    if os.path.isfile(target):
        entries = [target]
    elif os.path.isdir(target):
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if not should_ignore(d)]
            for f in sorted(files):
                if not should_ignore(f):
                    entries.append(os.path.join(root, f))
    else:
        print(f"ERROR: Path not found: {target}", file=sys.stderr)
        sys.exit(1)

    # Build manifest
    lines = ["", "<!-- SOURCE MANIFEST (auto-generated by generate-source-manifest.py) -->"]
    lines.append("<!-- DO NOT EDIT MANUALLY -->")
    lines.append("")
    lines.append("## Source Manifest")
    lines.append("")
    lines.append("| File | Size | Last Modified |")
    lines.append("|------|------|---------------|")

    for path in entries:
        try:
            st = os.stat(path)
            rel = os.path.relpath(path, project)
            mtime = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime))
            size = f"{st.st_size:,} B"
            lines.append(f"| `{rel}` | {size} | {mtime} |")
        except OSError:
            pass

    lines.append("")
    lines.append(f"<!-- Generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} -->")

    print("\n".join(lines))

if __name__ == "__main__":
    main()
```
```

---

# Appendix — P2-2 修正

INSERT 在 Source Map 表末（`| agnix config linting ...` 行之后）:

```
| exploring / benchmarking / free-ideation SKILL.md 完整设计 | v3 Patch 1 + v3 Review Patch 2 | §6.8–§6.10 |
| designing/SKILL.md 完整设计 | v3 Patch 1 + v3 Review Patch 2 | §6.11 |
| writing-plans/SKILL.md 完整设计 | v3 Review Patch 2 | §6.5 + §6.12 |
| using-git-worktrees/SKILL.md 完整设计 | v3 Patch 1 + v3 Review Patch 2 | §6.5 + §6.13 |
| using-workflow/SKILL.md 完整设计 | v3 Review Patch 2 | §7.6 |
| pre-write.py Gate 2 pyyaml 修正 | v3 Review Patch 2 | §9 pre-write.py |
| generate-source-manifest.py 脚本 | v3 Review Patch 2 | §9 + §2 |
| doc-sync lang 路径修正 | v3 Review Patch 2 | §7.5 |
| committing phase 值修正 | v3 Review Patch 2 | §7.3 |
```

---

## Document Footer 更新

REPLACE:
```
*Workflow Skills System Design v3 — End of Document*
*Deliverables: 1 CLAUDE.md · 13 Core Skills · 5 Auxiliary Skills · 1 Entry Skill*
*5 Personas · 5 Hooks · 5 Scripts · 1 settings.json · 1 index.schema.json*
*2 Runtime schemas (session.yaml v2 · sprint-status.yaml)*
```

WITH:
```
*Workflow Skills System Design v3 — End of Document*
*Last Patch: Review Patch 2 (2026-03-06) — 13 fixes (5×P0 + 5×P1 + 3×P2)*
*Deliverables: 1 CLAUDE.md · 13 Core Skills · 5 Auxiliary Skills · 1 Entry Skill*
*5 Personas · 5 Hooks · 6 Scripts · 1 settings.json · 1 index.schema.json*
*2 Runtime schemas (session.yaml v2 · sprint-status.yaml)*
```

---

*End of Patch 2*
*Apply on top of: workflow-skills-system-design-v3.md*
*Next: 待办 Phase 5 items (STAR gate / git history instinct / agnix CI)*
