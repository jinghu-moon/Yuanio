import { MessageType } from "@yuanio/shared";

// ── 类型定义 ──

/** 最小 schema 接口，兼容 Zod 但不直接依赖 */
export interface SchemaLike<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export interface RpcHandlerMeta {
  /** 是否为写操作 */
  write: boolean;
  /** 参数校验 schema（可选） */
  paramsSchema?: SchemaLike;
  /** 处理函数 */
  handler: (params: Record<string, unknown>, ctx: RpcContext) => Promise<unknown>;
}

export interface RpcSecurityConfig {
  mode: "full" | "readonly";
  root: string | null;
  allowlist: Set<string> | null;
}

export interface RpcContext {
  security: RpcSecurityConfig;
  sendEnvelope: (type: MessageType, plaintext: string, seqOverride?: number) => Promise<void>;
  onProjectSwitched?: (path: string) => Promise<void> | void;
  getForegroundProbe?: () => Record<string, unknown>;
  getExecutionMode?: () => "act" | "plan";
  setExecutionMode?: (mode: "act" | "plan", source?: "app" | "telegram" | "system") => Promise<string> | string;
  getPermissionMode?: () => string;
  setPermissionMode?: (mode: string) => Promise<string> | string;
  listCheckpoints?: (limit?: number) => unknown[];
  restoreCheckpoint?: (id: string) => Promise<unknown>;
  getTaskPanel?: () => unknown;
  getContextUsage?: () => unknown;
  compactContext?: (instructions?: string) => Promise<unknown> | unknown;
  rewindPreview?: (target: string) => unknown;
  rewindToMessage?: (target: string, dryRun?: boolean) => Promise<unknown> | unknown;
  listTasks?: (limit?: number) => unknown[];
  getTaskOutput?: (taskId: string) => unknown;
  stopTask?: (taskId: string) => boolean;
  getMemoryStatus?: () => unknown;
  setMemoryEnabled?: (enabled: boolean) => unknown;
  addMemoryNote?: (note: string, topic?: string) => unknown;
  listAgents?: () => unknown[];
  saveAgent?: (agent: Record<string, unknown>) => unknown;
  deleteAgent?: (name: string) => boolean;
  getPermissionRules?: () => unknown;
  setPermissionRules?: (rules: Record<string, unknown>) => unknown;
  getSandboxPolicy?: () => unknown;
  setSandboxPolicy?: (policy: Record<string, unknown>) => unknown;
  listOutputStyles?: () => unknown[];
  getOutputStyle?: () => unknown;
  setOutputStyle?: (styleId: string) => unknown;
  getStatusline?: () => Promise<string> | string;
  setStatusline?: (input: { enabled?: boolean; command?: string }) => unknown;
  invokeSkill?: (name: string, args?: string) => Promise<unknown> | unknown;
  listSkills?: () => unknown[];
  listSlashCommands?: () => unknown[];
  skillInstallPrepare?: (input: { source: string; scope?: "project" | "user" }) => Promise<unknown> | unknown;
  skillInstallCommit?: (input: {
    installId: string;
    selected?: string[] | string;
    force?: boolean;
    conflictPolicy?: "skip" | "overwrite" | "rename";
  }) => Promise<unknown> | unknown;
  skillInstallCancel?: (input: { installId: string }) => Promise<unknown> | unknown;
  skillInstallStatus?: (input: { installId: string }) => Promise<unknown> | unknown;
}

// ── RpcRegistry ──

export class RpcRegistry {
  private handlers = new Map<string, RpcHandlerMeta>();

  register(method: string, meta: RpcHandlerMeta): void {
    this.handlers.set(method, meta);
  }

  registerAll(entries: Record<string, RpcHandlerMeta>): void {
    for (const [method, meta] of Object.entries(entries)) {
      this.handlers.set(method, meta);
    }
  }

  unregister(method: string): boolean {
    return this.handlers.delete(method);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  methods(): string[] {
    return Array.from(this.handlers.keys());
  }

  async dispatch(
    method: string,
    params: Record<string, unknown>,
    ctx: RpcContext,
  ): Promise<{ result?: unknown; error?: string; errorCode?: string }> {
    const { security } = ctx;

    // 白名单检查
    if (security.allowlist && !security.allowlist.has(method)) {
      return { error: `rpc method not allowed: ${method}`, errorCode: "RPC_METHOD_NOT_ALLOWED" };
    }

    // 查找 handler
    const meta = this.handlers.get(method);
    if (!meta) {
      return { error: `unknown method: ${method}`, errorCode: "RPC_METHOD_UNKNOWN" };
    }

    // readonly 模式检查
    if (security.mode === "readonly" && meta.write) {
      return { error: `rpc readonly mode: ${method} blocked`, errorCode: "RPC_READONLY_BLOCKED" };
    }

    // 参数校验
    if (meta.paramsSchema) {
      const parsed = meta.paramsSchema.safeParse(params);
      if (!parsed.success) {
        return { error: `params validation failed: ${parsed.error.message}`, errorCode: "RPC_PARAMS_INVALID" };
      }
    }

    // 执行 handler
    try {
      const result = await meta.handler(params, ctx);
      return { result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (() => {
        if (e && typeof e === "object" && "code" in e) {
          const raw = (e as { code?: unknown }).code;
          if (typeof raw === "string" && raw.trim().length > 0) return raw;
        }
        return "RPC_HANDLER_ERROR";
      })();
      return { error: msg, errorCode: code };
    }
  }
}

