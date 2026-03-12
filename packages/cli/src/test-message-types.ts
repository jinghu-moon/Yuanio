// 测试 Phase 3.2 新消息类型：tool_call, file_diff, approval_req/resp, status
import {
  generateKeyPair, deriveSharedKey,
  createEnvelope, openEnvelope,
  MessageType, SeqCounter,
} from "@yuanio/shared";
import type { Envelope, ToolCallPayload, FileDiffPayload, ApprovalReqPayload, ApprovalRespPayload, StatusPayload } from "@yuanio/shared";
import {
  connectRelayWs,
  decodeWsData,
  isTextEnvelope,
  normalizeEnvelopePayload,
  parseWsFrame,
  sendWsFrame,
  toWsMessageFrame,
  waitForWsOpen,
} from "./relay-options";

const serverUrl = process.argv[2] || "http://localhost:3000";

// 1. 配对
const agentKp = generateKeyPair();
const appKp = generateKeyPair();

const createRes = await fetch(`${serverUrl}/api/v1/pair/create`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ publicKey: agentKp.publicKey }),
});
const { pairingCode, sessionToken: agentToken, deviceId: agentId, sessionId } = await createRes.json();

const joinRes = await fetch(`${serverUrl}/api/v1/pair/join`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: pairingCode, publicKey: appKp.publicKey }),
});
const appData = await joinRes.json();
console.log(" 配对完成");

const agentKey = deriveSharedKey(agentKp.secretKey, appKp.publicKey);
const appKey = deriveSharedKey(appKp.secretKey, agentKp.publicKey);

// 2. 双方连接
const agentSocket = connectRelayWs(serverUrl, agentToken);
const appSocket = connectRelayWs(serverUrl, appData.sessionToken);

await Promise.all([
  waitForWsOpen(agentSocket, 8000),
  waitForWsOpen(appSocket, 8000),
]);
console.log(" 双方已连接");

const seq = new SeqCounter();
const received: { type: MessageType; payload: string }[] = [];

// App 监听所有消息
appSocket.on("message", (data) => {
  const parsed = parseWsFrame(decodeWsData(data));
  if (!parsed.ok) return;
  const frame = parsed.frame as { type: string; data?: unknown };
  if (frame.type !== "message") return;
  const env = normalizeEnvelopePayload(frame.data as Envelope);
  if (!isTextEnvelope(env)) return;
  const payload = openEnvelope(env, appKey);
  received.push({ type: env.type, payload });
});

// 3. Agent 发送各类新消息
// 3a. STATUS
const statusPayload: StatusPayload = { status: "running", projectPath: "/test/project" };
sendWsFrame(agentSocket, toWsMessageFrame(createEnvelope(
  agentId, appData.deviceId, sessionId,
  MessageType.STATUS, JSON.stringify(statusPayload), agentKey, seq.next(),
)));
console.log("[agent] 发送 STATUS");

await new Promise((r) => setTimeout(r, 300));

// 3b. TOOL_CALL (running)
const toolRunPayload: ToolCallPayload = { tool: "Read", params: { path: "/test.ts" }, status: "running" };
sendWsFrame(agentSocket, toWsMessageFrame(createEnvelope(
  agentId, appData.deviceId, sessionId,
  MessageType.TOOL_CALL, JSON.stringify(toolRunPayload), agentKey, seq.next(),
)));
console.log("[agent] 发送 TOOL_CALL (running)");

await new Promise((r) => setTimeout(r, 300));

// 3c. TOOL_CALL (done)
const toolDonePayload: ToolCallPayload = { tool: "Read", params: {}, status: "done", result: "file content here" };
sendWsFrame(agentSocket, toWsMessageFrame(createEnvelope(
  agentId, appData.deviceId, sessionId,
  MessageType.TOOL_CALL, JSON.stringify(toolDonePayload), agentKey, seq.next(),
)));
console.log("[agent] 发送 TOOL_CALL (done)");

await new Promise((r) => setTimeout(r, 300));

// 3d. FILE_DIFF
const diffPayload: FileDiffPayload = { path: "src/index.ts", diff: "@@ -1 +1 @@\n-old\n+new", action: "modified" };
sendWsFrame(agentSocket, toWsMessageFrame(createEnvelope(
  agentId, appData.deviceId, sessionId,
  MessageType.FILE_DIFF, JSON.stringify(diffPayload), agentKey, seq.next(),
)));
console.log("[agent] 发送 FILE_DIFF");

await new Promise((r) => setTimeout(r, 300));

// 3e. APPROVAL_REQ
const approvalId = "approval_1";
const approvalReqPayload: ApprovalReqPayload = { id: approvalId, description: "删除文件", tool: "Bash", affectedFiles: ["src/old.ts"], permissionMode: "default" };
sendWsFrame(agentSocket, toWsMessageFrame(createEnvelope(
  agentId, appData.deviceId, sessionId,
  MessageType.APPROVAL_REQ, JSON.stringify(approvalReqPayload), agentKey, seq.next(),
)));
console.log("[agent] 发送 APPROVAL_REQ");

await new Promise((r) => setTimeout(r, 300));

// 3f. App 回复 APPROVAL_RESP
const approvalRespPayload: ApprovalRespPayload = { id: approvalId, approved: true };
const agentReceived: { type: MessageType; payload: string }[] = [];
agentSocket.on("message", (data) => {
  const parsed = parseWsFrame(decodeWsData(data));
  if (!parsed.ok) return;
  const frame = parsed.frame as { type: string; data?: unknown };
  if (frame.type !== "message") return;
  const env = normalizeEnvelopePayload(frame.data as Envelope);
  if (!isTextEnvelope(env)) return;
  agentReceived.push({ type: env.type, payload: openEnvelope(env, agentKey) });
});

sendWsFrame(appSocket, toWsMessageFrame(createEnvelope(
  appData.deviceId, agentId, sessionId,
  MessageType.APPROVAL_RESP, JSON.stringify(approvalRespPayload), appKey, seq.next(),
)));
console.log("[app] 发送 APPROVAL_RESP");

// 等待所有消息传递
await new Promise((r) => setTimeout(r, 1000));

// 4. 验证
let pass = true;

// 验证 App 收到的消息
const check = (idx: number, expectedType: MessageType, label: string, validator: (p: any) => boolean) => {
  if (!received[idx] || received[idx].type !== expectedType) {
    console.log(` ${label}: 未收到或类型不匹配 (got: ${received[idx]?.type})`);
    pass = false;
    return;
  }
  const parsed = JSON.parse(received[idx].payload);
  if (!validator(parsed)) {
    console.log(` ${label}: 载荷验证失败`, parsed);
    pass = false;
  } else {
    console.log(` ${label}`);
  }
};

check(0, MessageType.STATUS, "STATUS", (p) => p.status === "running" && p.projectPath === "/test/project");
check(1, MessageType.TOOL_CALL, "TOOL_CALL (running)", (p) => p.tool === "Read" && p.status === "running");
check(2, MessageType.TOOL_CALL, "TOOL_CALL (done)", (p) => p.status === "done" && p.result === "file content here");
check(3, MessageType.FILE_DIFF, "FILE_DIFF", (p) => p.path === "src/index.ts" && p.action === "modified");
check(4, MessageType.APPROVAL_REQ, "APPROVAL_REQ", (p) => p.tool === "Bash" && p.affectedFiles.length === 1);

// 验证 Agent 收到 APPROVAL_RESP
if (agentReceived[0]?.type === MessageType.APPROVAL_RESP) {
  const resp = JSON.parse(agentReceived[0].payload);
  if (resp.approved === true) {
    console.log(" APPROVAL_RESP (agent 收到)");
  } else {
    console.log(" APPROVAL_RESP: approved 不为 true");
    pass = false;
  }
} else {
  console.log(" APPROVAL_RESP: agent 未收到");
  pass = false;
}

agentSocket.close();
appSocket.close();

if (pass) {
  console.log("\n 所有新消息类型测试通过");
} else {
  console.log("\n 部分测试失败");
  process.exit(1);
}
process.exit(0);
