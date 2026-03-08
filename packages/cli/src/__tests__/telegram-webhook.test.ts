import { describe, expect, it } from "bun:test";
import {
  buildTelegramDedupKey,
  normalizeTelegramCommand,
  parseTelegramCallback,
  parseTelegramCommand,
  resolveTelegramIngressNetworkMode,
  shouldSkipTelegramUpdate,
} from "../telegram-webhook";

describe("telegram-webhook parser", () => {
  it("解析命令并去除 bot 后缀", () => {
    const parsed = parseTelegramCommand("/status@my_bot");
    expect(parsed).toEqual({ command: "status", args: [] });
  });

  it("解析带参数命令", () => {
    const parsed = parseTelegramCommand("/approve apr_123");
    expect(parsed).toEqual({ command: "approve", args: ["apr_123"] });
  });

  it("解析 cwd 命令参数", () => {
    const parsed = parseTelegramCommand("/cwd ./packages/cli");
    expect(parsed).toEqual({ command: "cwd", args: ["./packages/cli"] });
  });

  it("解析 probe 命令", () => {
    const parsed = parseTelegramCommand("/probe");
    expect(parsed).toEqual({ command: "probe", args: [] });
  });

  it("解析 history 命令", () => {
    const parsed = parseTelegramCommand("/history 20");
    expect(parsed).toEqual({ command: "history", args: ["20"] });
  });

  it("解析 task 命令", () => {
    const parsed = parseTelegramCommand("/task task_12");
    expect(parsed).toEqual({ command: "task", args: ["task_12"] });
  });

  it("解析 mode 命令", () => {
    const parsed = parseTelegramCommand("/mode plan");
    expect(parsed).toEqual({ command: "mode", args: ["plan"] });
  });

  it("解析 checkpoint restore 命令", () => {
    const parsed = parseTelegramCommand("/checkpoint restore ckpt_123");
    expect(parsed).toEqual({ command: "checkpoint", args: ["restore", "ckpt_123"] });
  });

  it("解析 compact 命令", () => {
    const parsed = parseTelegramCommand("/compact keep risks");
    expect(parsed).toEqual({ command: "compact", args: ["keep", "risks"] });
  });

  it("解析 rewind 命令", () => {
    const parsed = parseTelegramCommand("/rewind ckpt_abc --dry-run");
    expect(parsed).toEqual({ command: "rewind", args: ["ckpt_abc", "--dry-run"] });
  });

  it("命令别名归一（bug/quit/reload_plugins）", () => {
    expect(normalizeTelegramCommand("bug")).toBe("feedback");
    expect(normalizeTelegramCommand("quit")).toBe("exit");
    expect(normalizeTelegramCommand("reload_plugins")).toBe("reload-plugins");
  });

  it("非命令文本返回 null", () => {
    expect(parseTelegramCommand("hello yuanio")).toBeNull();
  });

  it("解析审批回调", () => {
    const parsed = parseTelegramCallback("apr:y:apr_123");
    expect(parsed).toEqual({
      kind: "interaction_action",
      payload: { action: "approve", approvalId: "apr_123" },
    });
  });

  it("解析控制回调", () => {
    const parsed = parseTelegramCallback("cmd:stop");
    expect(parsed).toEqual({
      kind: "interaction_action",
      payload: { action: "stop" },
    });
  });

  it("解析统一交互回调", () => {
    const parsed = parseTelegramCallback("ia:reject:apr_456");
    expect(parsed).toEqual({
      kind: "interaction_action",
      payload: { action: "reject", approvalId: "apr_456" },
    });
  });

  it("解析恢复会话回调", () => {
    const parsed = parseTelegramCallback("resume:abc123");
    expect(parsed).toEqual({ kind: "resume", sessionId: "abc123" });
  });

  it("解析 skills 翻页回调", () => {
    const parsed = parseTelegramCallback("skills:page:3");
    expect(parsed).toEqual({ kind: "skills_page", page: 3 });
  });

  it("解析 approvals 翻页回调", () => {
    const parsed = parseTelegramCallback("approvals:page:2");
    expect(parsed).toEqual({ kind: "approvals_page", page: 2 });
  });

  it("解析 approvals 批量回调", () => {
    const parsed = parseTelegramCallback("approvals:bulk:y:4");
    expect(parsed).toEqual({ kind: "approvals_bulk", approved: true, page: 4 });
  });

  it("解析交互输入回调", () => {
    const parsed = parseTelegramCallback("in:opt:2");
    expect(parsed).toEqual({ kind: "interactive", input: "2", behavior: "prompt" });
  });

  it("基于 update_id 去重", () => {
    const cache = new Map<number, number>();
    expect(shouldSkipTelegramUpdate(1001, cache)).toBe(false);
    expect(shouldSkipTelegramUpdate(1001, cache)).toBe(true);
    expect(shouldSkipTelegramUpdate(undefined, cache)).toBe(false);
  });

  it("超过上限后淘汰最旧 update_id", () => {
    const cache = new Map<number, number>();
    expect(shouldSkipTelegramUpdate(1, cache, 2)).toBe(false);
    expect(shouldSkipTelegramUpdate(2, cache, 2)).toBe(false);
    expect(shouldSkipTelegramUpdate(3, cache, 2)).toBe(false);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(true);
    expect(cache.has(3)).toBe(true);
  });

  it("构建 message 去重 key", () => {
    const key = buildTelegramDedupKey({
      update_id: 10,
      message: {
        chat: { id: 1234 },
        message_id: 99,
        text: "hi",
      },
    });
    expect(key).toBe("msg:1234:99");
  });

  it("构建 callback 去重 key", () => {
    const key = buildTelegramDedupKey({
      update_id: 11,
      callback_query: {
        id: "cb_1",
        data: "cmd:continue",
      },
    });
    expect(key).toBe("cb:cb_1");
  });

  it("解析 telegram ingress 网络模式", () => {
    expect(resolveTelegramIngressNetworkMode({
      YUANIO_TELEGRAM_NETWORK_MODE: "cloudflare",
      YUANIO_INGRESS_NETWORK_MODE: "lan",
    })).toBe("cloudflare");
    expect(resolveTelegramIngressNetworkMode({
      YUANIO_INGRESS_NETWORK_MODE: "public",
    })).toBe("public");
    expect(resolveTelegramIngressNetworkMode({
      YUANIO_NETWORK_MODE: "lan",
    })).toBe("lan");
    expect(resolveTelegramIngressNetworkMode({})).toBe("unknown");
  });
});
