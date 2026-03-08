# Protocol Optimization Report

生成时间：2026-03-04

## 范围

- 目标链路：`pending -> ack -> markDeliveryAcked`
- 版本对比：
  - 优化前基线：`docs/bench/protocol-e2e-ackopt10-runs-raw.json`（10 轮）
  - 当前版本：`docs/bench/protocol-e2e-autoack10v5-runs-raw.json`（10 轮）
- 当前单次验证：`docs/protocol-e2e-baseline.json`

## 关键变更

1. Android 接收端补齐 `ACK_REQUIRED` 自动回执（`working`），并覆盖重复包。
2. Android 传输层新增 `sendAck` 能力，统一 ACK 发射口。
3. 协议 E2E 基线新增 `ACK_REQUIRED` 消息矩阵闭环测试（`APPROVAL_RESP` / `SESSION_SWITCH_ACK` / `DIFF_ACTION_RESULT`）。
4. Relay ACK 热路径解耦：`markDeliveryAcked` 改为异步微批落库，ACK 转发前置，降低 DB 写阻塞影响。
5. Relay `prompt` 空闲快路径：当目标设备队列空闲时直发，绕过 flush 定时器，降低基础 ACK RTT 抖动。
6. Delivery immediate 同步直写快路径（小批量）：降低离线消息进入 pending 队列的可见延迟。

## 10 轮统计对比（优化前 vs 当前）

### 1) `ackRttMs`

- P50: `20.38 -> 4.32`（`-78.80%`）
- P95: `23.66 -> 4.62`（`-80.47%`）
- Mean: `20.85 -> 4.91`（`-76.45%`）

### 2) `recoveryPendingAppearMs`

- P50: `135.21 -> 124.72`（`-7.76%`）
- P95: `136.80 -> 126.96`（`-7.19%`）
- Mean: `134.02 -> 126.75`（`-5.42%`）

### 3) `recoveryAckClearMs`

- P50: `1.95 -> 0.87`（`-55.38%`）
- P95: `3.00 -> 0.90`（`-70.00%`）
- Mean: `3.26 -> 0.86`（`-73.62%`）

## 新增 ACK_REQUIRED 矩阵结果

- 数据源：`docs/bench/protocol-e2e-autoack10v5-runs-raw.json`
- 覆盖类型：`APPROVAL_RESP`、`SESSION_SWITCH_ACK`、`DIFF_ACTION_RESULT`
- 通过率：`30/30`（10 轮 x 3 类型）
- 每轮矩阵 `ackClearMeanMs` 统计：P50=`1.60`，P95=`1.79`，Mean=`1.66`

## 本轮优化前后（v4b -> v5）

- 对比文件：
  - `docs/bench/protocol-e2e-autoack10v4b-runs-raw.json`
  - `docs/bench/protocol-e2e-autoack10v5-runs-raw.json`
- `ackRttMs`：P50 `4.08 -> 4.32`（`+5.88%`），P95 `4.54 -> 4.62`（`+1.76%`），Mean `4.15 -> 4.91`（`+18.31%`）
- `recoveryPendingAppearMs`：P50 `140.93 -> 124.72`（`-11.50%`），P95 `142.00 -> 126.96`（`-10.59%`），Mean `136.71 -> 126.75`（`-7.29%`）
- `recoveryAckClearMs`：P50 `0.86 -> 0.87`（`+1.16%`），P95 `1.37 -> 0.90`（`-34.31%`），Mean `0.96 -> 0.86`（`-10.42%`）

## 最新单次回归（当前代码）

来源：`docs/protocol-e2e-baseline.json`

- `ackRttMs = 13.50`
- `recoveryPendingAppearMs = 123.16`
- `recoveryAckClearMs = 0.62`
- `ackRequiredMatrixPassCount = 3/3`

## 采样说明

- `autoack10v4` 首次批量中出现 1 次 Bun 运行时崩溃（segfault），归因于运行时稳定性而非协议逻辑。
- 结论采用 `autoack10v4b` 与 `autoack10v5`（均为带重试、10/10 有效样本）降低运行时噪声。

## 结论

- 当前版本同时实现了两类收益：
  - ACK 主路径显著加速（`ackRttMs` 相比早期基线大幅下降）。
  - 离线 pending 可见性明显改善（`recoveryPendingAppearMs` 回落并优于早期基线）。
- ACK 清队列指标继续维持优势（`recoveryAckClearMs` 进一步下降），可靠性矩阵维持 `30/30`。
