import type { TelegramApprovalsPageResult } from "../telegram-webhook";

export interface TelegramApprovalsContext {
  approvalsListToPageIds: (page: number) => string[];
  buildApprovalsPageResult: (page: number, banner?: string) => string | TelegramApprovalsPageResult;
  settleApproval: (id: string, approved: boolean, source: "app" | "telegram") => Promise<boolean>;
}

function parsePage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw || "");
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export async function handleTelegramApprovalsCommand(
  args: string[],
  ctx: TelegramApprovalsContext,
): Promise<string | TelegramApprovalsPageResult> {
  const action = (args[0] || "list").trim().toLowerCase();
  if (action === "bulk") {
    const modeRaw = (args[1] || "").trim().toLowerCase();
    const approved = modeRaw === "approve" || modeRaw === "approved" || modeRaw === "y" || modeRaw === "yes";
    const reject = modeRaw === "reject" || modeRaw === "rejected" || modeRaw === "n" || modeRaw === "no";
    if (!approved && !reject) {
      return "用法: /approvals bulk <approve|reject> [page]";
    }
    const page = parsePage(args[2], 1);
    const ids = ctx.approvalsListToPageIds(page);
    if (ids.length === 0) {
      return ctx.buildApprovalsPageResult(page, "本页无待审批项");
    }
    let success = 0;
    for (const id of ids) {
      const ok = await ctx.settleApproval(id, approved, "telegram");
      if (ok) success += 1;
    }
    const banner = `${approved ? "批量批准" : "批量拒绝"}完成：${success}/${ids.length}`;
    return ctx.buildApprovalsPageResult(page, banner);
  }
  if (action === "page") {
    return ctx.buildApprovalsPageResult(parsePage(args[1], 1));
  }
  return ctx.buildApprovalsPageResult(parsePage(args[0], 1));
}
