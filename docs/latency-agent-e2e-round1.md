# 真实 Agent 端到端基准（Round 1）

- 时间: 2026-03-03
- 范围: `packages/cli/src/test-latency-agent-e2e.ts`
- Agent: `codex`

## 问题与修复

1. 脚本“卡住不退出”
- 根因: `setupRemoteMode` 会启动本地服务与定时器，主流程结束后进程仍有活动句柄。
- 修复: 脚本主入口改为 `main().then(() => process.exit(0))`，确保成功完成后主动退出。

2. `sendToAckOkMs` 频繁为空
- 根因: `STREAM_END` 后过快结束迭代，`ok` ACK 到达窗口不足。
- 修复: 在 `STREAM_END` 后等待 `ok` ACK（最多 1500ms）再收口。

3. `--warmup 0` 不生效
- 根因: 参数解析仅允许正整数。
- 修复: `argInt` 增加 `allowZero`，`warmup` 支持 0。

## 三次原始结果

- `docs/latency-agent-e2e.round1.run1.json`
- `docs/latency-agent-e2e.round1.run2.json`
- `docs/latency-agent-e2e.round1.run3.json`

## 三次中值结果

- `docs/latency-agent-e2e.round1.median.md`
- `docs/latency-agent-e2e.round1.median.json`

## 关键中值（agent-e2e）

- `sendToAckWorkingMs`: P50 0.70 / P95 4.34 / Max 4.77
- `sendToFirstThinkingMs`: P50 10169.42 / P95 13622.33 / Max 13670.35
- `sendToFirstChunkMs`: P50 10128.56 / P95 13727.73 / Max 13842.14
- `sendToEndMs`: P50 11288.63 / P95 14589.15 / Max 14704.10
- `sendToAckOkMs`: P50 11295.83 / P95 14600.66 / Max 14716.14

