# Agent E2E 三次基准（取中值）

生成时间: 2026-03-03T17:09:50.231Z

测试命令:
- `bun run packages/cli/src/test-latency-agent-e2e.ts --out docs/benchmarks/agent-e2e-runN.md --json-out docs/benchmarks/agent-e2e-runN.json`
- agent=`codex`, warmup=`1`, iterations=`4`, autoRelay=`true`

源文件:
- `docs/benchmarks/agent-e2e-run1.json`
- `docs/benchmarks/agent-e2e-run2.json`
- `docs/benchmarks/agent-e2e-run3.json`

## 核心指标（毫秒）

| 指标 | Run1 P50 | Run2 P50 | Run3 P50 | 三次中值 P50 | Run1 P95 | Run2 P95 | Run3 P95 | 三次中值 P95 | Run1 Max | Run2 Max | Run3 Max | 三次中值 Max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| sendToAckFirstMs | 25.03 | 26.99 | 31.57 | 26.99 | 28.06 | 30.67 | 47.11 | 30.67 | 28.42 | 31.27 | 49.85 | 31.27 |
| sendToAckWorkingMs | 25.03 | 26.99 | 31.57 | 26.99 | 28.06 | 30.67 | 47.11 | 30.67 | 28.42 | 31.27 | 49.85 | 31.27 |
| sendToAckOkMs | 11,825.63 | 12,027.73 | 11,444.21 | 11,825.63 | 12,930.48 | 21,809.51 | 13,764.94 | 13,764.94 | 13,036.60 | 23,157.92 | 14,148.78 | 14,148.78 |
| sendToFirstThinkingMs | 25.10 | 27.03 | 31.62 | 27.03 | 28.13 | 30.71 | 70.28 | 30.71 | 28.48 | 31.31 | 77.10 | 31.31 |
| sendToFirstChunkMs | 10,960.04 | 11,066.05 | 10,579.51 | 10,960.04 | 12,063.57 | 20,866.86 | 12,961.71 | 12,961.71 | 12,176.76 | 22,219.30 | 13,305.40 | 13,305.40 |
| sendToEndMs | 11,825.70 | 12,027.80 | 11,445.05 | 11,825.70 | 12,930.63 | 21,810.80 | 13,765.28 | 13,765.28 | 13,036.77 | 23,159.43 | 14,148.89 | 14,148.89 |

## 握手指标（毫秒，三次中值）

| 指标 | Run1 | Run2 | Run3 | 三次中值 |
|---|---:|---:|---:|---:|
| pairCreateMs | 40.59 | 37.70 | 35.56 | 37.70 |
| pairJoinMs | 22.73 | 22.01 | 22.07 | 22.07 |
| deriveAgentKeyMs | 0.59 | 0.78 | 0.53 | 0.59 |
| deriveAppKeyMs | 0.25 | 0.29 | 0.23 | 0.25 |
| appConnectMs | 15.79 | 10.74 | 10.07 | 10.74 |

## 结论摘要
- sendToAckFirstMs P50 三次中值: 26.99 ms
- sendToFirstChunkMs P50 三次中值: 10,960.04 ms
- sendToEndMs P50 三次中值: 11,825.70 ms
- 当前主要瓶颈仍在模型首包与总生成时延，不在链路 ACK。