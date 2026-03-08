# Workflow Skills System Design — v3 Patch 1
# Changes: Three entry points rename + sandbox mode toggle
# Base: workflow-skills-system-design-v3.md

---

## 变更概要

| # | 变更 | 影响范围 |
|---|------|----------|
| 1 | 三入口重命名：exploring / benchmarking / free-ideation | 文件树、CLAUDE.md 路由、skill 设计 |
| 2 | 原 ideation（架构设计）→ designing | 同上 |
| 3 | 沙箱模式开关（sandbox_mode）| .claude/config.yaml + CLAUDE.md + start.md + worktree SKILL.md |

---

# P1 — 三入口重命名

## 1.1 完整流程更新

```
exploring       ┐
benchmarking    ┼──→  /designing  →  /plan  →  /execute ...
free-ideation   ┘
        ↑
    三者同级，输出均汇入 /designing
```

| 旧名 | 新名 | 含义 |
|------|------|------|
| brainstorming | exploring | 有想法，但不多，探索具体化 |
| （缺失） | benchmarking | 参考已有项目，重新设计 |
| ideation（当前） | free-ideation | 无目标，自由发散构思 |
| ideation（架构设计阶段） | designing | 输入三入口产物，输出架构决策 |

---

## 1.2 文件树差异（仅变更部分）

```diff
 .claude/skills/
-├── brainstorming/                ← 旧
-│   ├── SKILL.md
-│   └── references/
-│       └── question-templates.md
-│
-├── ideation/                     ← 旧（两个角色混用导致语义混乱）
-│   ├── SKILL.md
-│   └── references/
-│       └── design-template.md
+├── exploring/                    ← 新 Skill 1a：有想法，探索具体化
+│   ├── SKILL.md
+│   └── references/
+│       └── question-templates.md
+│
+├── benchmarking/                 ← 新 Skill 1b：参考已有项目，重新设计
+│   ├── SKILL.md
+│   └── references/
+│       └── gap-matrix-template.md
+│
+├── free-ideation/                ← 新 Skill 1c：无目标，自由构思
+│   ├── SKILL.md
+│   └── references/
+│       └── ideation-canvas.md
+│
+├── designing/                    ← 新 Skill 2：架构设计（原 ideation 架构职责）
+│   ├── SKILL.md
+│   └── references/
+│       └── design-template.md
```

核心流程顺序更新：

```
旧: 1.brainstorming → 2.ideation → 3.using-git-worktrees → 4.writing-plans
新: 1a.exploring    ┐
    1b.benchmarking ┼→ 2.designing → 3.using-git-worktrees → 4.writing-plans
    1c.free-ideation┘
```

---

## 1.3 CLAUDE.md 路由表变更（仅 Core Workflow 段）

```markdown
### Core Workflow Skills

| Command Pattern         | Load Target                                                        |
|-------------------------|--------------------------------------------------------------------|
| /explore $0             | .claude/skills/exploring/SKILL.md                                  |
| /benchmark $0           | .claude/skills/benchmarking/SKILL.md                               |
| /free-ideate            | .claude/skills/free-ideation/SKILL.md                              |
| /design                 | .claude/skills/designing/SKILL.md                                  |
| /worktree $0            | .claude/skills/using-git-worktrees/SKILL.md                        |
| /plan $0                | .claude/skills/writing-plans/SKILL.md                              |
| /tdd                    | .claude/skills/test-driven-development/SKILL.md                    |
| /execute [node|test|verify] [$0] | .claude/skills/executing-plans/SKILL.md                  |
| /debug                  | .claude/skills/systematic-debugging/SKILL.md                       |
| /verify                 | .claude/skills/verification-before-completion/SKILL.md             |
| /review                 | .claude/skills/requesting-code-review/SKILL.md                     |
| /review-feedback $0     | .claude/skills/receiving-code-review/SKILL.md                      |
| /finish-branch          | .claude/skills/finishing-a-development-branch/SKILL.md             |
```

Skill Registry 更新：

```markdown
## 6. SKILL REGISTRY

Core (13):
  exploring · benchmarking · free-ideation · designing ·
  using-git-worktrees · writing-plans · test-driven-development ·
  executing-plans · systematic-debugging · verification-before-completion ·
  requesting-code-review · receiving-code-review · finishing-a-development-branch

Auxiliary (5): code-insight · doc-sync · tracking-changes · committing · using-workflow
Entry (1): workflow
```

---

## 1.4 三个入口 Skill 设计

### `exploring/SKILL.md`

```markdown
---
name: exploring
description: Clarifies a vague or half-formed idea through structured questioning.
  Use when you have an idea but it is not fully defined.
  Triggers: /explore $0, "有想法", "探索一下", "我在想".
  Output: a concrete problem statement ready for /design.
  Usage: /explore "I want to build a redirect engine"
allowed-tools:
  - Read
  - WebSearch
---

# Exploring

## Purpose
转化半成型想法 → 清晰的问题陈述（Problem Statement）。

## Step 0 — Announce
OUTPUT: "🚀 Using exploring to clarify: $0"

## Step 1 — Load Question Templates
LOAD references/question-templates.md

## Step 2 — Socratic Questioning (max 5 rounds)
APPLY question templates to $0:
  Round 1: What problem does this solve? Who has this problem?
  Round 2: What does "done" look like? How will you know it works?
  Round 3: What are the constraints? (time / tech stack / scale)
  Round 4: What already exists? Why not use it?
  Round 5: What is the riskiest assumption?

RULES:
  - Ask ONE question per round. AWAIT answer before next.
  - IF answer reveals the idea is out of scope or infeasible:
    OUTPUT warning. Ask if user wants to pivot or stop.
  - DO NOT propose solutions during questioning.
  - DO NOT ask all 5 rounds if clarity achieved earlier.

## Step 3 — Problem Statement Output

OUTPUT EXACTLY:
  ```
  📋 PROBLEM STATEMENT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Problem:      {one sentence}
  User:         {who has this problem}
  Success:      {measurable definition of done}
  Constraints:  {tech / time / scale limits}
  Assumptions:  {top 2-3 riskiest assumptions}
  Out of Scope: {explicitly excluded}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔵 Ready for /design? [yes / refine more]
  ```
```

---

### `benchmarking/SKILL.md`

```markdown
---
name: benchmarking
description: Analyzes a reference project to inform your own design decisions.
  Use when you want to learn from or improve upon an existing project.
  Triggers: /benchmark $0, "参考项目", "对标", "类似 X 的项目".
  Output: gap matrix + design decisions ready for /design.
  Usage: /benchmark https://github.com/obra/superpowers
         /benchmark "Notion-like editor"
allowed-tools:
  - Read
  - WebSearch
---

# Benchmarking

## Purpose
分析参考项目 → 差距矩阵 + 取舍决策（Design Decisions）。

## Step 0 — Announce
OUTPUT: "🚀 Using benchmarking to analyze: $0"

## Step 1 — Reference Resolution
  IF $0 is a URL:
    FETCH repository/product page → extract: features, architecture, tech stack
  IF $0 is a product name:
    SEARCH for: "{$0} features", "{$0} architecture", "{$0} github"
    EXTRACT key characteristics from top 3 results

## Step 2 — Three-Phase Analysis

### Phase A: Analyze (reference project)
  EXTRACT from reference:
    - Core features list (rank by user value)
    - Architecture patterns (monolith/microservice/plugin-based etc.)
    - Tech stack choices
    - Known pain points or limitations (search issues/reviews)
    - Design philosophy (explicit or inferred)

### Phase B: Compare (against your context)
  READ .ai/init-report.md (if exists) for your project context
  BUILD gap matrix:

  | Feature / Pattern | Reference | Your Target | Gap | Decision |
  |-------------------|-----------|-------------|-----|----------|
  | {item}            | ✅ has    | ❌ missing  | Y   | Adopt/Skip/Redesign |

  DECISION values:
    Adopt     → take as-is, minimal changes
    Adapt     → take the concept, redesign implementation
    Skip      → not relevant to your use case
    Redesign  → reference approach has known flaws, do differently
    Defer     → valid but out of scope for now

### Phase C: Decide (explicit choices)
  FOR each "Adopt" or "Adapt" row:
    STATE: what specifically you are taking and why
  FOR each "Redesign" row:
    STATE: what was wrong with reference approach + your alternative

## Step 3 — Output

OUTPUT EXACTLY:
  ```
  📊 BENCHMARKING REPORT: {reference_name}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Reference Stack:  {tech stack}
  Reference Model:  {architecture pattern}
  Analysis Date:    {today}

  Gap Matrix:
  {gap matrix table}

  Design Decisions:
  ✅ Adopt:    {list}
  🔄 Adapt:    {list with rationale}
  ⏭ Skip:     {list with reason}
  🔨 Redesign: {list with alternative}
  ⏳ Defer:    {list}

  Key Insight: {one paragraph summary}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔵 Ready for /design? [yes / analyze another reference]
  ```
```

---

### `free-ideation/SKILL.md`

```markdown
---
name: free-ideation
description: Open-ended brainstorming with no fixed goal. Use when you have free time
  and want to discover what is worth building. Generates and ranks candidate ideas.
  Triggers: /free-ideate, "没有目标", "随便做点什么", "有空", "构思一下".
  Output: ranked idea list ready for /explore or /design.
allowed-tools:
  - Read
  - WebSearch
---

# Free Ideation

## Purpose
从零发散 → 候选想法列表（按价值排序）→ 选定一个进入 /explore 或 /design。

## Step 0 — Announce
OUTPUT: "🚀 Using free-ideation to discover what's worth building."

## Step 1 — Context Gathering (optional, ask user)
  ASK (one question): "有没有以下任何方向偏好？"
  OPTIONS:
    A. 解决自己的痛点
    B. 技术探索（想试某个技术栈）
    C. 复刻/改进已有工具
    D. 完全随机
  AWAIT response. IF user skips → treat as D.

## Step 2 — Idea Generation (per selected direction)

  IF A (pain points):
    ASK: "最近遇到什么重复性的麻烦事？"
    GENERATE 5 ideas from user's answer using "How Might We" framing.

  IF B (tech exploration):
    ASK: "想探索哪个技术方向？"
    SEARCH: "{tech} interesting projects 2025"
    GENERATE 5 ideas combining the tech with practical use cases.

  IF C (improve existing):
    ASK: "有没有某个工具你觉得可以做得更好？"
    APPLY benchmarking logic (light version) to generate 5 improvement ideas.

  IF D (random):
    READ .ai/index.json (if exists) → infer user's domain from file types
    GENERATE 5 ideas in detected domain + 2 outside domain (wild cards)

## Step 3 — Scoring

  SCORE each idea on 3 axes (1–5 each):
    Feasibility:  Can this be built in reasonable time with available stack?
    Interest:     How interesting/fun is this to build?
    Value:        Would this be useful to at least one real person?

  SORT by total score DESC.

## Step 4 — Output

OUTPUT EXACTLY:
  ```
  💡 IDEATION RESULTS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {for each idea, ranked}
  #{rank}. {title} (F:{n} I:{n} V:{n} = {total}/15)
     {one-sentence description}
     Stack hint: {suggested tech}
     Risk: {biggest unknown}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔵 Pick an idea to develop:
     [1-{n}] → /explore #{idea}
     [r]     → regenerate with different direction
     [q]     → quit, I'll think more
  ```
```

---

### `designing/SKILL.md` (原 ideation 架构职责)

```markdown
---
name: designing
description: Translates a problem statement or benchmark report into architecture
  decisions and a technical design. This is the convergence point for all three
  entry skills (exploring / benchmarking / free-ideation).
  Triggers: /design. Always preceded by one of the three entry skills.
  Output: technical design document, approved by user, ready for /plan.
  MUST NOT proceed to /plan without explicit user approval.
allowed-tools:
  - Read
  - WebSearch
---

# Designing

## Purpose
将探索/对标/构思的产物 → 技术架构决策 → 用户批准 → 送入 /plan。

## Step 0 — Announce + Input Detection
OUTPUT: "🚀 Using designing to create technical architecture."

READ previous step output:
  IF problem-statement present → MODE = from-exploring
  IF gap-matrix present → MODE = from-benchmarking
  IF idea-list present → MODE = from-free-ideation
  IF none → ASK user to describe the goal (one paragraph)

## Step 1 — Architecture Design

PRODUCE (all sections required):

  ### Component Map
  List top-level components and their responsibilities.
  For each: name / role / interface (inputs + outputs) / constraints

  ### Tech Stack Decisions
  For each choice: option chosen / alternatives considered / rationale
  IF stack already detected from .ai/init-report.md: confirm or override.

  ### Data Model (if applicable)
  Key entities + relationships. Do NOT define full schema here.

  ### Integration Points
  External deps, APIs, file formats, protocols.

  ### Non-Goals (explicit)
  What this design deliberately does NOT cover.

## Step 2 — Risk Assessment
  List top 3 risks:
    - Risk: {description}
    - Likelihood: High/Med/Low
    - Mitigation: {approach}

## Step 3 — User Approval Gate (MUST NOT skip)

OUTPUT:
  ```
  📐 TECHNICAL DESIGN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {design sections above}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔵 Approve design?
     [yes]    → proceed to /plan
     [revise] → specify what to change
     [scope]  → adjust scope (expand/shrink)
  ```

AWAIT user response. DO NOT call /plan automatically.

IF yes:
  WRITE .ai/workflow/design-decisions.md (append-only)
  OUTPUT: "Design approved. Run /plan to create implementation nodes."
```

---

# P2 — 沙箱模式开关

## 2.1 设计决策

**开关位置：** `.claude/config.yaml`（项目级持久化，跨 session）

**优先级：**

```
.claude/config.yaml (项目默认)
  ↑ 可被覆盖
session.yaml → sandbox_mode (单次 session 临时覆盖)
  ↑ 可被覆盖
/worktree --off 或 /worktree --on (单次命令覆盖)
```

**触发时机：** `/workflow start` 和 `/plan` 完成后，进入 `/execute` 前自动检查。

---

## 2.2 `.claude/config.yaml` （新文件）

```yaml
# .claude/config.yaml
# Project-level agent configuration.
# Committed to repo. Shared across all sessions on this project.

workflow:
  # sandbox_mode: controls whether git worktree isolation is used.
  # true  = always create worktree before /execute (default, recommended)
  # false = work directly on current branch (no isolation)
  # ask   = prompt user at /workflow start each time
  sandbox_mode: true

  # default_execute_mode: normal | auto | batch
  default_execute_mode: normal

  # auto_changelog: automatically run /changelog after each /execute verify
  auto_changelog: false

  # require_design_approval: require /design before /plan is allowed
  require_design_approval: true
```

---

## 2.3 CLAUDE.md 新增 Section（插入 Section 4 之后）

```markdown
## 5. PROJECT CONFIG

READ .claude/config.yaml on session start.
IF file missing: use defaults (sandbox_mode=true, default_execute_mode=normal).

| Config Key | Default | Effect |
|------------|---------|--------|
| sandbox_mode | true | true=worktree required / false=skip / ask=prompt |
| default_execute_mode | normal | feeds into /execute mode selection |
| auto_changelog | false | auto /changelog after each verified node |
| require_design_approval | true | /plan blocked until /design approved |

PERSIST effective config to session.yaml → config (read-only snapshot).
```

---

## 2.4 `session.yaml` 新增字段

```yaml
# 在 session.yaml 中新增 config 快照（session start 时写入，只读）
config:
  sandbox_mode: true       # effective value (config.yaml → session override → command flag)
  sandbox_actual_branch: "feature/dry-run"   # 若启用 worktree，记录实际 branch 名
  sandbox_worktree_path: ".worktrees/feature-dry-run"   # worktree 路径（若启用）
```

---

## 2.5 `workflow/operations/start.md` 沙箱检查逻辑

```markdown
# Operation: Start
# TRIGGER: /workflow start $0

## Step 1 — Initialize Session
  TASK = $0
  READ .claude/config.yaml → effective_sandbox_mode
  WRITE session.yaml: run_id / task / current_phase=plan / config snapshot

## Step 2 — Sandbox Mode Check

  IF effective_sandbox_mode == true:
    → 沙箱开启，自动进入 worktree 流程（见 Step 3）

  IF effective_sandbox_mode == false:
    OUTPUT: "⚠️ sandbox_mode=false: working directly on current branch."
    OUTPUT: "  Branch: $(git branch --show-current)"
    → 跳过 Step 3，直接进入 Step 4

  IF effective_sandbox_mode == ask:
    OUTPUT:
      ```
      🔵 沙箱模式（git worktree 隔离）
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      启用沙箱：在独立 worktree 中开发，不影响主分支
      跳过沙箱：直接在当前分支开发（更快，但无隔离）
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      🔵 [yes / no]
      ```
    IF yes  → effective_sandbox_mode = true,  proceed to Step 3
    IF no   → effective_sandbox_mode = false, proceed to Step 4
    WRITE session.yaml → config.sandbox_mode = effective value

## Step 3 — Worktree Setup (sandbox_mode = true only)
  LOAD .claude/skills/using-git-worktrees/SKILL.md
  FOLLOW worktree setup steps.
  WRITE session.yaml → config.sandbox_actual_branch / config.sandbox_worktree_path
  OUTPUT: "✅ Worktree created: {path} on branch: {branch}"

## Step 4 — Route to Plan
  OUTPUT: "🚀 Session started. Run /plan {task} to create implementation nodes."
  WRITE session.yaml: next_action = "/plan {task}"
```

---

## 2.6 `using-git-worktrees/SKILL.md` 更新

```markdown
---
name: using-git-worktrees
description: Creates or manages git worktrees for isolated development environments.
  Automatic: triggered by /workflow start when sandbox_mode=true.
  Manual: /worktree $0 to create, /worktree --off to disable for this session,
          /worktree --on to re-enable.
  Usage: /worktree feature/my-feature
         /worktree --off    (disable sandbox for this session only)
         /worktree --on     (re-enable sandbox for this session)
allowed-tools:
  - Bash(git:*)
---

# Using Git Worktrees

## Trigger Modes

| Trigger | Mode | Behavior |
|---------|------|----------|
| /workflow start (sandbox=true) | Auto | Create worktree, write session.yaml |
| /worktree $0 | Manual | Create named worktree |
| /worktree --off | Override | Disable sandbox for current session |
| /worktree --on | Override | Re-enable sandbox for current session |
| /worktree --status | Info | Show active worktrees |

## Auto Mode (from /workflow start)

BRANCH_NAME = slugify(session.task):
  lowercase, spaces→hyphens, strip special chars
  PREFIX: "feature/" if new feature, "fix/" if bug fix
  EXAMPLE: "add dry-run mode" → "feature/add-dry-run-mode"

RUN:
  git worktree add .worktrees/{branch_name} -b {branch_name}

ON SUCCESS:
  WRITE session.yaml:
    config.sandbox_actual_branch: {branch_name}
    config.sandbox_worktree_path: ".worktrees/{branch_name}"
  OUTPUT: "✅ Sandbox ready: .worktrees/{branch_name}"

ON FAILURE (branch exists):
  SUGGEST: git worktree add .worktrees/{branch_name}-2 {branch_name}
  AWAIT user decision.

## Override: --off

  WRITE session.yaml → config.sandbox_mode = false
  OUTPUT: "⚠️ Sandbox disabled for this session. Working on: $(git branch --show-current)"
  OUTPUT: "  To re-enable: /worktree --on"
  OUTPUT: "  To change project default: edit .claude/config.yaml → sandbox_mode"

## Override: --on

  IF session.yaml has no prior worktree_path:
    → Run Auto Mode to create worktree
  ELSE:
    SWITCH to existing worktree_path
    OUTPUT: "✅ Sandbox re-enabled: {worktree_path}"

## Cleanup (auto-called by /finish-branch)

  RUN: git worktree remove .worktrees/{branch_name}
  RUN: git branch -d {branch_name}    # only if merged
  WRITE session.yaml → config.sandbox_worktree_path = null
```

---

## 2.7 `/finish-branch/SKILL.md` 沙箱清理补充

在现有 finish-branch 流程末尾新增：

```markdown
## Sandbox Cleanup (execute ONLY if session.config.sandbox_mode == true)

  READ session.yaml → config.sandbox_worktree_path, config.sandbox_actual_branch

  STEP A — Confirm merge status
    RUN: git branch --merged main | grep {sandbox_actual_branch}
    IF not merged: OUTPUT warning. ASK "Clean up unmerged worktree? [yes/no]"

  STEP B — Remove worktree
    RUN: git worktree remove {sandbox_worktree_path} [--force if unmerged+confirmed]
    ON SUCCESS: OUTPUT "✅ Worktree removed: {sandbox_worktree_path}"

  STEP C — Update session
    WRITE session.yaml → current_phase = "done"
    WRITE session.yaml → config.sandbox_worktree_path = null
    WRITE session.yaml → config.sandbox_actual_branch = null
```

---

## 2.8 全局流程（含沙箱开关）

```
/workflow start <task>
  ↓
  Read .claude/config.yaml → sandbox_mode
       │
       ├─ true  → auto: /worktree → create worktree → proceed
       ├─ false → skip worktree → proceed directly
       └─ ask   → 🔵 prompt user → branch on answer
  ↓
  [one of three entry skills]
  /explore   /benchmark   /free-ideate
       │
       └─ all → /design → user approves
  ↓
  /plan → node table
  ↓
  /execute node → /execute test → /execute verify (loop per node)
  ↓
  /verify → /review → verdict
       │
       ├─ PASS/CONCERNS → /commit
       ├─ REWORK        → /review-feedback → /execute ...
       └─ FAIL          → user intervention
  ↓
  /finish-branch
       │
       └─ sandbox_mode == true → auto cleanup worktree
```

---

## 2.9 `.gitignore` 建议新增

```gitignore
# Claude workflow worktrees
.worktrees/
```

---

# 汇总：文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `.claude/config.yaml` | 新增 | 项目级配置，含 sandbox_mode |
| `.claude/skills/exploring/` | 新增 | 原 brainstorming 重命名+增强 |
| `.claude/skills/benchmarking/` | 新增 | 全新 skill |
| `.claude/skills/free-ideation/` | 新增 | 原 ideation(发散) 重命名+独立 |
| `.claude/skills/designing/` | 新增 | 原 ideation(架构) 拆分独立 |
| `.claude/skills/brainstorming/` | 删除 | 拆分为 exploring + free-ideation |
| `.claude/skills/ideation/` | 删除 | 拆分为 free-ideation + designing |
| `.claude/skills/using-git-worktrees/SKILL.md` | 更新 | 新增 auto/override/cleanup 模式 |
| `.claude/skills/workflow/operations/start.md` | 更新 | 沙箱检查逻辑 |
| `.claude/skills/finishing-a-development-branch/SKILL.md` | 更新 | 沙箱清理步骤 |
| `CLAUDE.md` | 更新 | 路由表 + config section |
| `session.yaml` schema | 更新 | 新增 config 快照字段 |
| `.gitignore` | 建议新增 | `.worktrees/` |

---

*End of Patch 1*
*Apply on top of: workflow-skills-system-design-v3.md*
