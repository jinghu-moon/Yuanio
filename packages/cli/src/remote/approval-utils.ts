export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalLevel = "all" | "medium" | "high" | "critical" | "none";

import type { PermissionMode } from "@yuanio/shared";

const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function assessRisk(
  tool: string,
  input: Record<string, unknown>,
): RiskLevel {
  const criticalTools = ["Bash", "bash", "shell", "execute"];
  const highTools = ["Write", "write_file", "Edit", "edit_file"];
  const mediumTools = ["Read", "read_file", "Glob", "grep"];

  if (criticalTools.some((t) => tool.includes(t))) {
    const cmd = typeof input.command === "string" ? input.command : String(input.command ?? "");
    if (/rm\s+-rf|sudo|chmod|chown|mkfs|dd\s/.test(cmd)) return "critical";
    return "high";
  }
  if (highTools.some((t) => tool.includes(t))) return "medium";
  if (mediumTools.some((t) => tool.includes(t))) return "low";
  return "medium";
}

export function resolveApprovalLevel(value?: string): ApprovalLevel {
  const raw = value?.toLowerCase();
  if (raw === "none") return "none";
  if (raw === "critical") return "critical";
  if (raw === "high") return "high";
  if (raw === "medium") return "medium";
  return "all";
}

export function shouldAutoApprove(risk: RiskLevel, level: ApprovalLevel): boolean {
  if (level === "none") return true;
  if (level === "all") return false;
  return RISK_ORDER[risk] < RISK_ORDER[level];
}

export async function buildFilePreview(files: string[]): Promise<string | undefined> {
  if (files.length === 0) return undefined;
  const previews: string[] = [];
  for (const f of files.slice(0, 3)) {
    try {
      const file = Bun.file(f);
      if (!(await file.exists())) continue;
      const size = file.size;
      if (size > 500_000) {
        previews.push(`--- ${f} (${Math.round(size / 1024)}KB, 过大跳过) ---`);
        continue;
      }
      const content = await file.text();
      previews.push(`--- ${f} ---\n${content.slice(0, 2000)}`);
    } catch {
      // 文件不可读，跳过
    }
  }
  return previews.length > 0 ? previews.join("\n") : undefined;
}

export function buildContext(tool: string, input: Record<string, unknown>): string {
  const parts: string[] = [`工具: ${tool}`];
  if (typeof input.file_path === "string") parts.push(`文件: ${input.file_path}`);
  if (typeof input.command === "string") parts.push(`命令: ${input.command.slice(0, 200)}`);
  if (typeof input.content === "string") parts.push(`内容长度: ${input.content.length} 字符`);
  if (typeof input.old_string === "string") parts.push(`替换: "${input.old_string.slice(0, 80)}..."`);
  parts.push(`工作目录: ${process.cwd()}`);
  return parts.join("\n");
}

export function buildRiskSummary(
  tool: string,
  riskLevel: RiskLevel,
  input: Record<string, unknown>,
): string {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  switch (riskLevel) {
    case "low":
      return `低风险：${tool} 主要为读取类操作，通常不会修改本地文件。`;
    case "medium":
      return `中风险：${tool} 可能会修改项目文件，请先确认关键 diff 片段。`;
    case "high":
      if (command) {
        return `高风险：将执行命令“${command.slice(0, 42)}”，可能影响当前工作区。`;
      }
      return `高风险：${tool} 包含写入或执行行为，请确认后再继续。`;
    case "critical":
      return "严重风险：该操作可能造成不可逆改动或系统级影响，请谨慎批准。";
    default:
      return `风险待确认：${tool}`;
  }
}

function capHighlight(line: string): string {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function buildDiffHighlights(input: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const command = typeof input.command === "string" ? input.command : "";
  if (command.trim()) {
    lines.push(capHighlight(`$ ${command}`));
  }

  const oldString = typeof input.old_string === "string" ? input.old_string : "";
  const newString = typeof input.new_string === "string" ? input.new_string : "";
  if (oldString.trim() || newString.trim()) {
    if (oldString.trim()) lines.push(capHighlight(`- ${oldString}`));
    if (newString.trim()) lines.push(capHighlight(`+ ${newString}`));
  }

  const content = typeof input.content === "string" ? input.content : "";
  if (content.trim()) {
    const previews = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .map((line) => capHighlight(`+ ${line}`));
    lines.push(...previews);
  }

  return lines.filter(Boolean).slice(0, 4);
}

// --- Phase 3: 权限模式 ---

/** 写操作工具集合 */
const WRITE_TOOLS = new Set([
  "Write", "write_file", "Edit", "edit_file",
  "Bash", "bash", "shell", "execute",
]);

/** 读+编辑工具集合（acceptEdits 模式自动批准） */
const EDIT_TOOLS = new Set([
  "Write", "write_file", "Edit", "edit_file",
  "Read", "read_file", "Glob", "grep",
]);

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: "默认（按风险等级审批）",
  acceptEdits: "自动批准读写（Shell 仍需审批）",
  yolo: "全部自动批准",
  readonly: "只读（阻止所有写操作）",
};

/**
 * 统一审批决策函数。
 * 综合权限模式 + 风险等级 + 审批等级，返回最终决策。
 */
export function resolveApprovalDecision(
  mode: PermissionMode,
  riskLevel: RiskLevel,
  tool: string,
  approvalLevel: ApprovalLevel,
): "approve" | "reject" {
  switch (mode) {
    case "yolo":
      return "approve";

    case "readonly":
      return WRITE_TOOLS.has(tool) ? "reject" : "approve";

    case "acceptEdits":
      if (EDIT_TOOLS.has(tool)) return "approve";
      // Shell 等非编辑工具走风险等级判断
      return shouldAutoApprove(riskLevel, approvalLevel) ? "approve" : "reject";

    case "default":
    default:
      return shouldAutoApprove(riskLevel, approvalLevel) ? "approve" : "reject";
  }
}
