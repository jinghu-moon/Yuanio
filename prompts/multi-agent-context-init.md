# Multi-Agent Context Initialization (Cross-Platform Edition)

> Compatible with: Claude Code, OpenAI Codex
> Version: 2.0
> Target: AI Agent (Full-Stack Code Analysis / Architecture Auditing)
> Trigger: New session initialization

## Objective

Analyze the provided project context and produce an evidence-based system schema.
Assume no prior knowledge. Base all conclusions strictly on the provided files
and on results obtained from explicitly permitted tools.

## Terminology

| Term | Definition |
|------|-----------|
| Coding Standards | The project's coding conventions, policy files, and style guides (e.g., `CLAUDE.md`, `AGENTS.md`, `.codex/`, `writing_style.md`, linter configs). |
| Blind Spot | Any claim, assumption, or area where direct evidence is missing or insufficient. |
| Evidence | Exact quotes, code snippets, or configuration values extracted from project files. |

## Roles (Internal Execution Model)

- Student:
  Performs structured analysis, summarizes observable facts, and explicitly
  flags unknowns as Blind Spots without making assumptions.

- Teacher:
  Audits the Student's analysis, rejects any unsupported claims, and requests
  verification through read-only tools when necessary.

> The Teacher-Student audit loop MUST be executed internally.
> Do NOT expose internal reasoning, chain-of-thought, or intermediate drafts.

## Execution Rules (RFC 2119)

The keywords MUST and SHOULD are to be interpreted as defined in RFC 2119.

### Rule 0: Capability Check

The agent MUST first identify which read-only tools are available
in the current environment before proceeding with analysis.

Unavailable tools MUST be noted and analysis scope adjusts accordingly.
If no tools are available, the agent MUST proceed with static analysis
of provided context only, and mark tool-dependent sections as Blind Spots.

### Rule 1: Analysis Order

The analysis MUST progress sequentially through the following layers:

1. **Layer 1 - Coding Standards**: Explicit rules and constraints
   (policy files, documented conventions, linter configs, style guides).
2. **Layer 2 - Build & Execution Flow**: Scripts, manifests, entry points,
   if evidence exists.
3. **Layer 3 - Backend Interfaces**: IPC / FFI / system calls,
   evidence-based only.
4. **Layer 4 - Frontend / Caller Interaction**: UI model, API consumers,
   evidence-based only.

### Rule 2: Evidence Standard

- The agent MUST extract exact quotes or code snippets before forming conclusions.
- Any claim without direct evidence MUST be marked as a Blind Spot.
- Cross-reference findings against Coding Standards when available.

### Rule 3: Fallback Protocol

- If source code is missing or a tool cannot be used, the agent MUST output
  "No evidence provided" and MUST NOT infer or guess.
- If an unknown library, framework, or convention is encountered,
  the Teacher SHOULD trigger a web lookup with a specific query
  (e.g., "What is [library_name] used for in [language]").

### Rule 4: Tool Usage (Abstract Layer)

Tool usage, if requested by the Teacher, MUST be read-only.

Permitted operation categories (agent maps to its own available tools):

| Operation | Claude Code | Codex | Fallback |
|-----------|------------|-------|----------|
| File inspection | `Read`, `Glob` | `cat`, `ls` | Manual paste |
| Pattern search | `Grep`, `Task(Explore)` | `grep`, `rg` | Ctrl+F |
| Web lookup | `WebSearch`, `WebFetch` | `web_search` | Mark as Blind Spot |
| Symbol analysis | `LSP`, Serena tools | `grep -n` | Mark as Blind Spot |

> The agent MUST use whichever tools are available in its environment.
> Do NOT fail silently — if a tool is unavailable, state it explicitly.

### Rule 5: Loop Limit

- The internal Teacher-Student audit loop MUST halt after a maximum of
  two iterations; iterate only if Teacher identifies unsupported claims.
- The loop SHOULD also halt early if:
  - Understanding_Score >= 80%, AND
  - No Blind Spots remain in Layer 1-2.
- If the agent's context budget is constrained, a single-pass analysis
  with explicit Blind Spot marking is acceptable.

## Input Context (To Be Populated)

Before execution, the following inputs SHOULD be provided:

- **Project Root**: Path to the project directory.
- **Key Config Files**: List of known configuration/policy files
  (e.g., `CLAUDE.md`, `package.json`, `Cargo.toml`, `pyproject.toml`).
- **Scope Hint** (optional): Specific area of interest
  (e.g., "authentication module", "build pipeline", "full project").

> If no inputs are provided, the agent MUST discover context autonomously
> starting from the project root, prioritizing Layer 1 files.

## Output Requirements (Final Answer Only)

After completing the internal audit loop, output ONLY the structure below.
Do NOT include internal reasoning, analysis steps, or review notes.

### 1. Metadata

```
- Type: [e.g., Desktop App | Web App | CLI Tool | Browser Extension | Library]
- Language: [Primary language(s)]
- Core_Loop: [One-sentence description of the primary control or data flow]
- Coding Standards Found: [List of discovered policy/style files, or "None"]
```

### 2. Imposed Constraints (Verified)

List ONLY constraints that are directly supported by code or configuration evidence.

Format each constraint as:
```
- [CONSTRAINT]: [Description]
  Evidence: [Exact quote or file:line reference]
```

Example:
```
- MUST NOT mutate props directly
  Evidence: writing_style.md:12 — "Components MUST NOT mutate props directly"
```

### 3. IPC & System Interface

> If the project does not involve IPC/FFI/system calls, output:
> "Not applicable — no IPC/FFI/system interface detected." and skip the table.

| Trigger | Command | Backend Impl | Permissions | Evidence Quote |
|---------|---------|--------------|-------------|----------------|
| [Event] | [Name]  | [Source]     | [Perms]     | [Exact quote]  |

### 4. Diagnostics & Final Verdict

**Understanding_Score**: [0-100%]

Scoring criteria:
```
90-100%  All four Layers have evidence coverage
70-89%   Layer 1-2 complete, Layer 3-4 have Blind Spots
50-69%   Layer 1 complete, Layer 2+ have Blind Spots
< 50%    Layer 1 has unverified constraints
```

**Ready_Nodes**: [Verified safe-to-modify files, or "None identified"]

**Blind_Spots**:
List all areas where evidence is missing or insufficient.
```
- [Layer]: [Description of what is unknown]
```

**Teacher_Flagged_Risks** (MUST list at least one):
```
1. [Risk description with evidence reference]
2. [Additional risk/clarification question]
```
