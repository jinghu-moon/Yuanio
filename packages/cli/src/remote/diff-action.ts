import { MessageType } from "@yuanio/shared";
import type { DiffActionPayload, DiffActionResultPayload } from "@yuanio/shared";

export async function handleDiffAction(
  da: DiffActionPayload,
  sendEnvelope: (type: MessageType, plaintext: string) => Promise<void>,
): Promise<void> {
  const result: DiffActionResultPayload = {
    path: da.path,
    action: da.action,
    success: false,
  };

  try {
    if (da.action === "rollback") {
      const proc = Bun.spawn(["git", "checkout", "--", da.path], {
        stdout: "pipe", stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      if (code !== 0) {
        result.error = stderr.trim() || `exit code ${code}`;
      } else {
        result.success = true;
      }
    } else {
      // accept = no-op，文件已在磁盘上
      result.success = true;
    }
  } catch (e: unknown) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  await sendEnvelope(
    MessageType.DIFF_ACTION_RESULT,
    JSON.stringify(result),
  );
}
