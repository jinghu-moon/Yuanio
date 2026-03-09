# Yuanio M1 可执行任务清单

> Version: `1.0`
> Updated: `2026-03-09`
> Source of Truth: `refer/yuanio-product-roadmap-v1.2.md`
> Execution Mode: `auto / node-by-node`

---

## Scope Gate

**In Scope**

- 首页第一版
- 环境页第一版
- 会话入口收敛到 `Home -> Sessions -> Chat`
- 底部导航按 M1 信息架构重排
- 终端页补一层显式连接状态与重连交互

**Out of Scope**

- 任务页 / 审批页 / 结果页一级导航
- 新协议字段
- `Hilt` / `GlobalSessionManager` / `StreamingMarkdown` / `MessageRepository`
- 大规模重写 `ChatViewModel` / `TerminalViewModel`

---

## Phase M1-A：信息架构与导航收敛

Phase Boundary:

```yaml
entry_condition:
  - refer/yuanio-product-roadmap-v1.2.md 已确认 M1 目标
  - android-app 当前可正常编译
exit_gate:
  cmd: ./gradlew :app:compileDebugKotlin --console=plain
  pass_signal: BUILD SUCCESSFUL
  coverage_min: n/a
rollback_boundary:
  revert_nodes:
    - M1-N1
    - M1-N2
  restore_point: 当前导航保留 pairing/chat/terminal/files/skills/settings 结构
```

### Nodes

| ID | Target | Action | Why | Verify | Risk | Depends |
|---|---|---|---|---|---|---|
| M1-N1 | `android-app/.../ui/navigation/Screen.kt` | 新增 `Home`、`Environment` 路由，并把会话入口显式收敛到 `Sessions` | 先固化 IA，再接页面 | `./gradlew :app:compileDebugKotlin --console=plain` | medium | - |
| M1-N2 | `android-app/.../ui/component/MainBottomBar.kt`、`BrandIcons.kt`、资源字符串/图标 | 将底部导航调整为 `Home / Sessions / Terminal / Environment / Settings` | M1 的主线是环境与会话，不再让 Files/Skills 占主导航位 | `./gradlew :app:compileDebugKotlin --console=plain` | medium | M1-N1 |

---

## Phase M1-B：首页与环境页

Phase Boundary:

```yaml
entry_condition:
  - M1-A 完成
  - 新导航已可编译
exit_gate:
  cmd: ./gradlew :app:compileDebugKotlin --console=plain
  pass_signal: BUILD SUCCESSFUL
  coverage_min: n/a
rollback_boundary:
  revert_nodes:
    - M1-N3
    - M1-N4
    - M1-N5
  restore_point: 保留新导航，撤回新增页面与入口联动
```

### Nodes

| ID | Target | Action | Why | Verify | Risk | Depends |
|---|---|---|---|---|---|---|
| M1-N3 | `android-app/.../ui/screen/HomeScreen.kt` | 新增首页，聚合当前连接、最近会话、快速动作 | 首页负责 5 秒判断“现在该去哪” | `./gradlew :app:compileDebugKotlin --console=plain` | medium | M1-N2 |
| M1-N4 | `android-app/.../ui/screen/EnvironmentScreen.kt` | 新增环境页，展示配对信息、连接模式、本地直连参数、健康摘要 | 环境页负责“我在控制哪台环境、走哪条链路” | `./gradlew :app:compileDebugKotlin --console=plain` | medium | M1-N2 |
| M1-N5 | `android-app/.../ui/navigation/NavGraph.kt`、`MainActivity.kt` | 将配对后与已配对启动入口改到 `Home`，保留 `Sessions -> Chat` 深链 | 会话页应从首页/会话页进入，避免一启动直接落聊天流 | `./gradlew :app:compileDebugKotlin --console=plain` | medium | M1-N3, M1-N4 |

tdd_required: false
tdd_exception:
  reason: 当前变更以 Compose 导航与页面装配为主，仓库内缺少对应 UI 自动化基线。
  alternative_verification:
    - cmd: ./gradlew :app:compileDebugKotlin --console=plain
      covers: 导航、页面、资源与 ViewModel 装配可编译性
    - cmd: ./gradlew :app:testDebugUnitTest --tests "*.ChatViewModelSessionGatewayTest" --tests "*.TerminalComponentTest" --console=plain
      covers: 现有会话共享与终端核心回归基线
  user_approved: true

---

## Phase M1-C：终端稳定性补强

Phase Boundary:

```yaml
entry_condition:
  - M1-B 完成
  - 首页与环境页已可进入
exit_gate:
  cmd: ./gradlew :app:testDebugUnitTest --tests "*.TerminalComponentTest" --tests "*.TerminalPerformanceTest" --console=plain
  pass_signal: BUILD SUCCESSFUL
  coverage_min: n/a
rollback_boundary:
  revert_nodes:
    - M1-N6
  restore_point: 终端页面维持原有行为，仅撤回新增状态条和重连交互
```

### Nodes

| ID | Target | Action | Why | Verify | Risk | Depends |
|---|---|---|---|---|---|---|
| M1-N6 | `android-app/.../ui/screen/TerminalScreen.kt` | 补充显式连接状态卡片与重连 CTA，使断连不再埋在菜单里 | 远程工作场景下，终端断连必须一眼可见且可恢复 | `./gradlew :app:testDebugUnitTest --tests "*.TerminalComponentTest" --tests "*.TerminalPerformanceTest" --console=plain` | low | M1-N5 |

---

## Phase M1-D：总验证

Phase Boundary:

```yaml
entry_condition:
  - M1-A / M1-B / M1-C 全部完成
exit_gate:
  cmd: ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest --tests "*.ChatViewModelSessionGatewayTest" --tests "*.TerminalComponentTest" --tests "*.TerminalPerformanceTest" --console=plain
  pass_signal: BUILD SUCCESSFUL
  coverage_min: n/a
rollback_boundary:
  revert_nodes:
    - M1-N1
    - M1-N2
    - M1-N3
    - M1-N4
    - M1-N5
    - M1-N6
  restore_point: M1 之前的 Android 导航和页面结构
```

### Nodes

| ID | Target | Action | Why | Verify | Risk | Depends |
|---|---|---|---|---|---|---|
| M1-N7 | `android-app/` | 运行 M1 汇总验证并修正编译 / 资源 / 连接状态回归 | 保证 M1 是“可进入、可编译、可回归”的最小闭环 | `./gradlew :app:compileDebugKotlin :app:testDebugUnitTest --tests "*.ChatViewModelSessionGatewayTest" --tests "*.TerminalComponentTest" --tests "*.TerminalPerformanceTest" --console=plain` | medium | M1-N6 |

---

## 执行结论

M1 的最小闭环标准是：

- 配对后进入 `Home`
- `Home` 可跳 `Sessions / Terminal / Environment`
- `Environment` 可看到当前环境与连接方式
- `Sessions` 继续承担选会话入口
- `Terminal` 断连时有显式状态与重连入口

达到以上标准，即视为 M1 第一轮落地完成。
