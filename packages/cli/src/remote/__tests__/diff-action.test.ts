import { describe, it, expect } from "bun:test";
import { handleDiffAction } from "../diff-action";
import { MessageType } from "@yuanio/shared";

describe("diff-action", () => {
  it("accept 不触发回滚且返回成功", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleDiffAction({ path: "dummy.txt", action: "accept" }, sendEnvelope);

    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe(MessageType.DIFF_ACTION_RESULT);
    const result = JSON.parse(sent[0].payload);
    expect(result.success).toBe(true);
    expect(result.path).toBe("dummy.txt");
  });
});
