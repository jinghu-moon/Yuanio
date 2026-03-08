# 首 Token / 首 Chunk 优化结论

- 时间: 2026-03-03
- 范围: 真实 Agent 端到端链路（`test-latency-agent-e2e.ts`）

## 结论

1. 协议层已不是主瓶颈
- `sendToAckWorkingMs` 已在毫秒级（P50 约 1ms 量级）。

2. 当前主瓶颈在模型产出阶段
- `sendToFirstChunkMs` 为秒级，属于模型推理与输出阶段开销。

3. 在当前环境下，Codex 明显快于 Claude
- 见: `docs/latency-agent-e2e.compare.round1.md`
- 尤其 `sendToFirstChunkMs` 与 `sendToEndMs`，Codex 中值显著更低。

## 本次已落地优化

1. 修复 CLI 参数传递导致的流式退化
- 文件: `packages/cli/src/spawn.ts`
- 变更:
  - 传给外部 CLI 的 prompt 先做单行归一化（避免 Windows `shell=true` 下多行参数破坏后续 flag）
  - 新增 `YUANIO_DEBUG_SPAWN_PARSE=1` 调试输出，便于定位非 JSON 输出

2. 默认 agent 策略改为可配置并偏向首包更快
- 新环境变量: `YUANIO_DEFAULT_AGENT`
- 支持值: `codex` / `claude` / `gemini`
- 默认值: `codex`
- 影响文件:
  - `packages/cli/src/remote.ts`
  - `packages/cli/src/index.ts`
  - `packages/cli/src/daemon-process.ts`

## 建议配置

```bash
YUANIO_DEFAULT_AGENT=codex
```

如需质量优先可切回:

```bash
YUANIO_DEFAULT_AGENT=claude
```

