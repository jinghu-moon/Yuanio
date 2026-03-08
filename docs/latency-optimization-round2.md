# 通信协议优化记录（Round 2）

- 时间: 2026-03-03
- 目标: 提升断线恢复稳定性、避免重复消息导致重复执行

## 本轮改动

1. CLI 入站消息全局去重（按 envelope.id）
- 文件: `packages/cli/src/remote.ts`
- 要点:
  - 新增 `processedInboundEnvelopeIds` 缓存
  - 对重复 `prompt` 仍回 ACK，避免发送端重试风暴
  - 去重上限支持环境变量 `YUANIO_MAX_PROCESSED_ENVELOPE_IDS`

2. Pending 队列改为分批持续 drain
- 文件: `packages/cli/src/remote/pending.ts`
- 要点:
  - 单次拉取改为最多 20 轮分批拉取
  - 增加“签名停滞检测”，防止同一批次无限循环
  - 队列过大时可在一次重连中尽量追平

3. Android 缺失消息恢复改为分页循环
- 文件: `android-app/app/src/main/java/com/yuanio/app/data/ApiClient.kt`
- 文件: `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
- 要点:
  - `fetchMissedMessages` 返回 `nextCursor`
  - `recoverMissedMessages` 循环拉取（最多 20 轮）
  - 每轮推进 `afterCursor/afterTs` 并持久化
  - 游标不前进时提前中断，避免死循环

## 编译验证

- `bun run typecheck` 通过
- `./android-app/gradlew.bat -p "android-app" :app:compileDebugKotlin` 通过

## 基准对比（快速口径）

- 口径: `--warmup 5 --iterations 20`
- 优化前: `docs/latency-baseline.json`
- 优化后: `docs/latency-baseline.post-opt.json`

| 场景 | 指标 | P50（前→后） | P95（前→后） | Max（前→后） |
|---|---|---:|---:|---:|
| text-small | sendToAckMs | 0.38 -> 0.47 | 0.49 -> 0.83 | 0.53 -> 2.45 |
| text-small | sendToFirstChunkMs | 0.45 -> 0.58 | 0.55 -> 0.87 | 0.56 -> 2.52 |
| text-large | sendToAckMs | 0.28 -> 0.46 | 0.39 -> 0.62 | 0.43 -> 0.63 |
| text-large | sendToFirstChunkMs | 0.32 -> 0.63 | 0.49 -> 0.80 | 0.52 -> 0.81 |
| binary-small | sendToEchoMs | 0.33 -> 0.60 | 2.43 -> 10.79 | 10.71 -> 12.54 |
| binary-large | sendToEchoMs | 0.24 -> 0.54 | 0.37 -> 0.73 | 0.42 -> 0.84 |

## 结论

- 本轮优化是“稳定性优先”改动（去重、批量恢复、防重放/防漏恢复），不是纯延迟路径加速。
- 在当前快速基准口径下，端到端时延未出现改善，且存在波动上升。
- 下一轮应聚焦纯延迟路径（消息序列化、调度优先级、通道拆分）并在固定负载/固定 CPU 频率下重测。
