export interface TelegramResumeItem {
  sessionId: string;
  label: string;
}

interface ForwardCommandCheckResult {
  ok: boolean;
  reason?: string;
}

export interface TelegramInteractionContext {
  executeInteractionAction: (payload: {
    action: "continue" | "stop" | "approve" | "reject" | "retry" | "rollback";
    source: "telegram";
    approvalId?: string;
    prompt?: string;
    reason?: string;
  }) => Promise<{ ok: boolean; message: string }>;
  listRecentResumeSessions: () => Array<{ sessionId: string; label: string }>;
  sendResumePrompt: (resumeSessionId: string) => Promise<void>;
  validateForwardCommand: (name: string) => ForwardCommandCheckResult;
  sendForwardPrompt: (rawText: string) => Promise<void>;
  sendInteractiveInput: (input: string) => Promise<void>;
}

export async function handleTelegramApproveCommand(
  specifiedId: string | undefined,
  ctx: TelegramInteractionContext,
): Promise<string> {
  const result = await ctx.executeInteractionAction({
    action: "approve",
    source: "telegram",
    approvalId: specifiedId,
  });
  return result.message;
}

export async function handleTelegramRejectCommand(
  specifiedId: string | undefined,
  ctx: TelegramInteractionContext,
): Promise<string> {
  const result = await ctx.executeInteractionAction({
    action: "reject",
    source: "telegram",
    approvalId: specifiedId,
  });
  return result.message;
}

export function handleTelegramResumeListCommand(
  ctx: TelegramInteractionContext,
): TelegramResumeItem[] {
  const sessions = ctx.listRecentResumeSessions();
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    label: s.label,
  }));
}

export async function handleTelegramResumeCommand(
  resumeSessionId: string,
  ctx: TelegramInteractionContext,
): Promise<string> {
  await ctx.sendResumePrompt(resumeSessionId);
  return `已请求恢复会话: ${resumeSessionId.slice(0, 12)}...`;
}

export async function handleTelegramForwardCommand(
  rawText: string,
  command: string,
  ctx: TelegramInteractionContext,
): Promise<string> {
  const name = command.toLowerCase();
  const check = ctx.validateForwardCommand(name);
  if (!check.ok) {
    return `命令 /${name} 已拒绝：${check.reason}`;
  }
  await ctx.sendForwardPrompt(rawText);
  return `已透传: ${rawText}`;
}

export async function handleTelegramInteractiveInput(
  input: string,
  ctx: TelegramInteractionContext,
): Promise<string> {
  await ctx.sendInteractiveInput(input);
  return `已发送输入: ${input}`;
}
