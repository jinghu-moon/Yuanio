# Yuanio 快捷导出方案（对齐 Claude/Codex/Gemini 流式输出）

## 1. 目标（本轮）

1. 新增“代码块导出为文件”能力，支持单块导出和批量导出。
2. 导出链路必须对齐三类 Agent 的真实输出方式：增量流式 + 完成事件收敛。
3. 满足快速开发期原则：允许破坏性改动，优先 `性能 > 占用 > 速度 > 兼容`。

## 2. 源码事实（必须遵守）

### 2.1 Codex（OpenAI）

1. TypeScript SDK 通过 `codex exec --experimental-json` 获取 JSONL 行流。  
   证据：`refer/agent-source-code/codex-main/sdk/typescript/src/exec.ts:73`
2. 事件为 `thread.started`、`turn.started`、`item.updated`、`item.completed`、`turn.completed`。  
   证据：`refer/agent-source-code/codex-main/sdk/typescript/src/events.ts:7`、`refer/agent-source-code/codex-main/sdk/typescript/src/events.ts:17`、`refer/agent-source-code/codex-main/sdk/typescript/src/events.ts:50`、`refer/agent-source-code/codex-main/sdk/typescript/src/events.ts:56`、`refer/agent-source-code/codex-main/sdk/typescript/src/events.ts:32`
3. `run()` 会缓冲到 turn 结束；`runStreamed()` 才是中间态事件。  
   证据：`refer/agent-source-code/codex-main/sdk/typescript/README.md:36`

### 2.2 Gemini CLI（Google）

1. `STREAM_JSON` 输出是 JSONL，事件类型包含 `init/message/tool_use/tool_result/error/result`。  
   证据：`refer/agent-source-code/gemini-cli-main/packages/core/src/output/types.ts:29`
2. `message` 事件支持 `delta: true`，代表增量文本。  
   证据：`refer/agent-source-code/gemini-cli-main/packages/core/src/output/types.ts:53`
3. 非交互模式里，`GeminiEventType.Content` 会实时发 `message(delta=true)`。  
   证据：`refer/agent-source-code/gemini-cli-main/packages/cli/src/nonInteractiveCli.ts:317`、`refer/agent-source-code/gemini-cli-main/packages/cli/src/nonInteractiveCli.ts:327`
4. 结束时发 `result` 事件作为最终收敛。  
   证据：`refer/agent-source-code/gemini-cli-main/packages/cli/src/nonInteractiveCli.ts:503`

### 2.3 Claude Agent SDK（Anthropic）

1. `query()` 返回 `AsyncGenerator`，本质是流式消息迭代。  
   证据：`refer/agent-source-code/claude-code-main/docs/sdk/sdk-typescript.md:20`、`refer/agent-source-code/claude-code-main/docs/sdk/sdk-typescript.md:31`
2. 打开 `includePartialMessages` 后，会包含部分消息流事件（partial）。  
   证据：`refer/agent-source-code/claude-code-main/docs/sdk/sdk-typescript.md:116`、`refer/agent-source-code/claude-code-main/docs/sdk/sdk-typescript.md:308`
3. CLI 侧 `--include-partial-messages` 仅在 `--output-format=stream-json` 时有效。  
   证据：`refer/agent-source-code/claude-code-main/docs/reference/cli-reference.md:55`

## 3. 结论：统一导出必须基于“聚合层”

不能直接拿最终文本做导出，必须先做“流式聚合层”：

1. 增量阶段：持续吸收 delta/updated 事件。
2. 收敛阶段：以 `turn.completed`（Codex）/`result`（Gemini）/最终 `SDKResultMessage`（Claude）固化快照。
3. 导出阶段：仅对“已固化快照”执行代码块提取和写文件，避免半截代码落盘。

## 4. 功能范围（重排）

### 4.1 MVP（本期必须做）

1. 导出聊天消息为文件：`md/txt/json`。
2. 新增“代码块导出为文件”：
   1. 单块导出：长按代码块 -> 导出文件。
   2. 本条消息全部代码块导出。
3. 追加写入最近文件（按 `sessionId + format`）。
4. 一键分享文件（`FileProvider`）。

### 4.2 下一期

1. 一次回复多代码块批量导出为目录或 zip。
2. 执行包导出：`chat.md + terminal.txt + meta.json + diff.patch`。
3. 脱敏导出：`token/key/secret` 规则掩码。

## 5. 代码块导出设计（核心）

### 5.1 解析规则

1. 输入：聚合后的 Markdown 文本（不是原始 delta）。
2. 解析对象：fenced code block（```lang ... ```）。
3. 提取字段：
   1. `language`
   2. `content`
   3. `index`（同一消息内序号）
   4. `suggestedFileName`（可选）

### 5.2 文件名推断优先级

1. 代码块 info string 中显式文件名（如 ```kotlin MainActivity.kt）。
2. 代码块首行注释提示（如 `// file: main.kt`、`# file: app.py`）。
3. 回退：`codeblock-{index}.{ext}`。

### 5.3 语言到扩展名映射（首批）

1. `kotlin/kt -> .kt`
2. `java -> .java`
3. `typescript/ts -> .ts`
4. `javascript/js -> .js`
5. `python/py -> .py`
6. `bash/sh/shell -> .sh`
7. `json -> .json`
8. `xml -> .xml`
9. `markdown/md -> .md`
10. 未知语言 -> `.txt`

### 5.4 冲突策略（快速开发默认）

1. 默认：自动重命名（`-1`, `-2`...）。
2. 可选：覆盖（后续在设置里开关）。
3. 不做复杂 merge。

## 6. 架构与文件改动

### 6.1 新建

1. `android-app/app/src/main/java/com/yuanio/app/data/export/ExportFileManager.kt`
2. `android-app/app/src/main/java/com/yuanio/app/data/export/ExportPrefs.kt`
3. `android-app/app/src/main/java/com/yuanio/app/data/export/CodeBlockExtractor.kt`
4. `android-app/app/src/main/java/com/yuanio/app/data/export/AgentStreamAggregator.kt`
5. `android-app/app/src/main/java/com/yuanio/app/ui/chat/ExportSheet.kt`

### 6.2 修改

1. `android-app/app/src/main/java/com/yuanio/app/data/MessageExporter.kt`
2. `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatViewModel.kt`
3. `android-app/app/src/main/java/com/yuanio/app/ui/screen/ChatScreen.kt`
4. `android-app/app/src/main/java/com/yuanio/app/ui/chat/MessageBubble.kt`（代码块菜单）
5. `android-app/app/src/main/AndroidManifest.xml`（FileProvider）
6. `android-app/app/src/main/res/xml/file_paths.xml`
7. `android-app/app/src/main/res/values/strings.xml`
8. `android-app/app/src/main/res/values-en/strings.xml`

## 7. 性能策略

1. 所有解析和 IO 在 `Dispatchers.IO`。
2. 聚合器增量处理，不反复全量重建字符串。
3. 导出写盘用 `BufferedWriter` 流式写，避免峰值内存。
4. Chat 列表中只在“代码块菜单打开/导出成功提示”时触发局部重组。

## 8. Phase 执行（可直接开工）

### Phase 1：流式聚合层

1. 建立 `AgentStreamAggregator` 统一模型（Codex/Gemini/Claude）。
2. 接入现有消息流入口，产出 `FinalTurnSnapshot`。
3. 校验终止条件：`turn.completed/result/final result`。

### Phase 2：代码块提取与文件导出

1. 实现 `CodeBlockExtractor`。
2. `ExportFileManager` 增加 `exportCodeBlock()` 和 `exportAllCodeBlocks()`。
3. 完成命名和冲突策略。

### Phase 3：UI 接入

1. `MessageBubble` 代码块长按菜单接入导出。
2. `ExportSheet` 增加“导出代码块”动作。
3. Snackbar 反馈路径与失败原因。

### Phase 4：追加写入与分享

1. `appendLastFile()` 落地。
2. `FileProvider` 分享链路稳定化。
3. 增加简单埋点：成功率、失败原因、耗时。

## 9. 验收标准

1. 流式回复过程中不产生半截代码导出文件。
2. 单块导出点击后 1 秒内返回结果提示（中小文件）。
3. 批量导出文件名可读，扩展名正确率 >= 95%（常见语言）。
4. 追加写入顺序正确、无覆盖事故。
5. 聊天滚动和输入不因导出操作出现明显卡顿。

## 10. 结论

1. 该方案已与 `claude/codex/gemini-cli` 的真实流式输出模型对齐。
2. MVP 先做“代码块导出文件 + 流式聚合收敛”，可最快提升实用价值。
3. 后续扩展执行包导出不需要推翻本期架构。
