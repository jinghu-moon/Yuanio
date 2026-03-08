import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleTaskQueue } from "../queue";
import { clearQueue, queueSize, setQueueMode } from "../../task-queue";
import { MessageType } from "@yuanio/shared";
import type { AgentHandle, AgentType } from "../../spawn";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("queue", () => {
  let prevCwd = "";
  let tempDir = "";

  beforeEach(() => {
    prevCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), "yuanio-queue-"));
    process.chdir(tempDir);
    clearQueue();
    setQueueMode("sequential");
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(tempDir, { recursive: true, force: true });
    clearQueue();
    setQueueMode("sequential");
  });

  it("enqueue 后可消费并发送状态", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const runningAgents = new Map<string, { handle: AgentHandle; agent: AgentType }>();
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };
    let consumedId = "";
    const onConsume = (item: { id: string }) => {
      consumedId = item.id;
    };

    await handleTaskQueue({ action: "enqueue", prompt: "hello" }, sendEnvelope, runningAgents, onConsume);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].type).toBe(MessageType.TASK_QUEUE_STATUS);
    expect(queueSize()).toBe(0);
    expect(consumedId).toBeTruthy();
  });

  it("clear 清空队列", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const runningAgents = new Map<string, { handle: AgentHandle; agent: AgentType }>();
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleTaskQueue({ action: "enqueue", prompt: "hello" }, sendEnvelope, runningAgents);
    await handleTaskQueue({ action: "clear" }, sendEnvelope, runningAgents);

    expect(queueSize()).toBe(0);
  });

  it("maxParallel 达到上限时不消费", async () => {
    setQueueMode("parallel");
    const sent: { type: MessageType; payload: string }[] = [];
    const runningAgents = new Map<string, { handle: AgentHandle; agent: AgentType }>();
    runningAgents.set("task_1", { handle: {} as AgentHandle, agent: "claude" });
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleTaskQueue(
      { action: "enqueue", prompt: "hello" },
      sendEnvelope,
      runningAgents,
      undefined,
      { maxParallel: 1 },
    );

    expect(queueSize()).toBe(1);
  });
});
