import type { TelegramApprovalsPageResult } from "../telegram-webhook";

interface PendingApprovalView {
  id: string;
  tool: string;
  riskLevel: string;
  createdAt: number;
}

interface DispatchRpcResult {
  result?: unknown;
  error?: string | null;
}

export interface CreateTelegramPanelsOptions {
  dispatchRpcForTelegram: (method: string, params?: Record<string, unknown>) => Promise<DispatchRpcResult>;
  getPendingApprovals: () => Map<string, { tool: string; riskLevel: string; createdAt: number }>;
  approvalsPageSizeRaw?: string;
}

function formatDateTimeForTelegram(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n).toLocaleString("zh-CN", { hour12: false });
}

export function clampTextForTelegram(value: string, maxChars = 2800): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 14))}\n...(truncated)`;
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw || "");
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function renderTaskOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((line) => (typeof line === "string" ? line : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function getPendingApprovalViews(pendingApprovals: Map<string, { tool: string; riskLevel: string; createdAt: number }>): PendingApprovalView[] {
  return Array.from(pendingApprovals.entries())
    .map(([id, meta]) => ({
      id,
      tool: String(meta.tool || "unknown"),
      riskLevel: String(meta.riskLevel || "unknown"),
      createdAt: Number(meta.createdAt || 0),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createTelegramPanels(options: CreateTelegramPanelsOptions) {
  const getApprovalPageSize = () => parsePositiveInt(options.approvalsPageSizeRaw, 6, 3, 12);

  const listTaskHistoryText = async (args: string[]): Promise<string> => {
    const limit = parsePositiveInt(args[0], 12, 5, 30);
    const { result, error } = await options.dispatchRpcForTelegram("list_tasks", { limit });
    if (error) return `history 查询失败: ${error}`;
    const items = ((result as { items?: Array<Record<string, unknown>> } | null)?.items) || [];
    if (items.length === 0) return "暂无任务历史";

    const lines = [
      `任务历史（最近 ${items.length} 条）`,
      "提示: /task <taskId> 查看详情",
    ];
    for (const item of items) {
      const taskId = String(item.taskId || "unknown");
      const status = String(item.status || "unknown");
      const agent = String(item.agent || "unknown");
      const source = String(item.source || "unknown");
      const started = formatDateTimeForTelegram(item.startedAt);
      const ended = formatDateTimeForTelegram(item.endedAt);
      const preview = String(item.promptPreview || "").trim();
      lines.push(`- ${taskId} [${status}] ${agent} · ${source}`);
      lines.push(`  started: ${started}${ended !== "-" ? ` · ended: ${ended}` : ""}`);
      if (preview) lines.push(`  ${preview}`);
    }
    return lines.join("\n");
  };

  const buildApprovalsPageResult = (
    requestedPage: number,
    banner?: string,
  ): TelegramApprovalsPageResult => {
    const items = getPendingApprovalViews(options.getPendingApprovals());
    const pageSize = getApprovalPageSize();
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(Math.max(1, totalItems) / pageSize));
    const page = Math.min(Math.max(1, requestedPage), totalPages);
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    const lines: string[] = [];
    if (banner) lines.push(banner);
    lines.push(`待审批列表（第 ${page}/${totalPages} 页，共 ${totalItems} 条）`);
    if (pageItems.length === 0) {
      lines.push("暂无待审批");
    } else {
      for (const [index, item] of pageItems.entries()) {
        const number = start + index + 1;
        const when = formatDateTimeForTelegram(item.createdAt);
        lines.push(`${number}. ${item.id}`);
        lines.push(`   tool=${item.tool} risk=${item.riskLevel} at=${when}`);
        lines.push(`   /approve ${item.id}`);
        lines.push(`   /reject ${item.id}`);
      }
      lines.push("可点击下方按钮翻页或批量处理本页");
    }

    return {
      text: lines.join("\n"),
      page,
      totalPages,
      totalItems,
    };
  };

  const approvalsListToPageIds = (page: number): string[] => {
    const pageResult = buildApprovalsPageResult(page);
    const items = getPendingApprovalViews(options.getPendingApprovals());
    const pageSize = getApprovalPageSize();
    const start = (pageResult.page - 1) * pageSize;
    return items.slice(start, start + pageSize).map((item) => item.id);
  };

  return {
    clampTextForTelegram,
    renderTaskOutputText,
    listTaskHistoryText,
    buildApprovalsPageResult,
    approvalsListToPageIds,
  };
}
