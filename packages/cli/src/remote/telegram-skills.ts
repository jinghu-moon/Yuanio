import type { TelegramSkillsPageResult } from "../telegram-webhook";

type DispatchRpcForTelegram = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<{ result?: unknown; error?: string; errorCode?: string }>;

export async function handleTelegramSkillCommand(
  name: string,
  args: string[],
  dispatchRpcForTelegram: DispatchRpcForTelegram,
): Promise<string> {
  const { result, error } = await dispatchRpcForTelegram("invoke_skill", { name, args: args.join(" ") });
  if (error) return `skill 调用失败: ${error}`;
  const data = (result ?? {}) as Record<string, unknown>;
  if (data.invoked !== true) return `skill 未执行: ${String(data.reason || "unknown")}`;
  return [
    `skill 已触发: ${name}`,
    `taskPromptId: ${String(data.taskPromptId || "")}`,
    `type: ${String(data.type || "skill")}`,
  ].join("\n");
}

export async function handleTelegramSkillsCommand(
  args: string[],
  dispatchRpcForTelegram: DispatchRpcForTelegram,
): Promise<string | TelegramSkillsPageResult> {
  const action = (args[0] || "list").trim().toLowerCase();
  if (action === "install") {
    const sourceTokens: string[] = [];
    let scope: "project" | "user" = "project";
    for (let i = 1; i < args.length; i += 1) {
      const token = args[i];
      const lower = token.toLowerCase();
      if (lower === "--scope" && i + 1 < args.length) {
        const next = args[i + 1].trim().toLowerCase();
        scope = next === "user" ? "user" : "project";
        i += 1;
        continue;
      }
      if (lower.startsWith("--scope=")) {
        const next = lower.slice("--scope=".length);
        scope = next === "user" ? "user" : "project";
        continue;
      }
      if (lower === "--user") {
        scope = "user";
        continue;
      }
      if (lower === "--project") {
        scope = "project";
        continue;
      }
      sourceTokens.push(token);
    }
    const source = sourceTokens.join(" ").trim();
    if (!source) {
      return [
        "用法: /skills install <source> [--scope project|user]",
        "示例: /skills install ./refer/teleclaude",
        "示例: /skills install owner/repo --scope user",
      ].join("\n");
    }
    const { result, error } = await dispatchRpcForTelegram("skill_install_prepare", { source, scope });
    if (error) return `skills prepare 失败: ${error}`;
    const data = (result ?? {}) as {
      installId?: string;
      candidates?: Array<{
        id?: string;
        name?: string;
        description?: string;
        path?: string;
        valid?: boolean;
        warnings?: string[];
      }>;
    };
    const installId = String(data.installId || "");
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (!installId) return "skills prepare 失败: installId 为空";
    if (candidates.length === 0) {
      return [
        `installId: ${installId}`,
        "未扫描到可安装的 skills",
      ].join("\n");
    }
    const lines = [
      `installId: ${installId}`,
      `scope: ${scope}`,
      `候选技能: ${candidates.length}`,
    ];
    for (const [index, item] of candidates.slice(0, 20).entries()) {
      const marker = item.valid === false ? "invalid" : "ok";
      const name = String(item.name || item.id || "unknown");
      const desc = String(item.description || "(no description)");
      const path = String(item.path || "");
      const warns = Array.isArray(item.warnings) && item.warnings.length > 0
        ? ` warnings=${item.warnings.join(",")}`
        : "";
      lines.push(`${index + 1}. [${marker}] ${name} - ${desc}`);
      lines.push(`   path=${path}${warns}`);
    }
    if (candidates.length > 20) {
      lines.push(`... 其余 ${candidates.length - 20} 项请先 /skills status ${installId} 查看`);
    }
    lines.push(`提交: /skills commit ${installId} all`);
    lines.push(`或: /skills commit ${installId} 1,2`);
    lines.push(`或: /skills commit ${installId} alpha,beta --overwrite`);
    return lines.join("\n");
  }

  if (action === "status") {
    const installId = String(args[1] || "").trim();
    if (!installId) return "用法: /skills status <installId>";
    const { result, error } = await dispatchRpcForTelegram("skill_install_status", { installId });
    if (error) return `skills status 失败: ${error}`;
    const data = (result ?? {}) as {
      state?: string;
      scope?: string;
      source?: string;
      candidateCount?: number;
      candidates?: Array<{ name?: string; description?: string; valid?: boolean }>;
      result?: { installed?: unknown[]; skipped?: unknown[]; failed?: unknown[]; total?: number } | null;
    };
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const installResult = data.result ?? null;
    const lines = [
      `installId: ${installId}`,
      `state: ${String(data.state || "unknown")}`,
      `scope: ${String(data.scope || "project")}`,
      `source: ${String(data.source || "")}`,
      `candidates: ${Number(data.candidateCount || candidates.length || 0)}`,
    ];
    for (const [index, item] of candidates.slice(0, 12).entries()) {
      const marker = item.valid === false ? "invalid" : "ok";
      lines.push(`${index + 1}. [${marker}] ${String(item.name || "unknown")} - ${String(item.description || "")}`);
    }
    if (installResult) {
      const installed = Array.isArray(installResult.installed) ? installResult.installed.length : 0;
      const skipped = Array.isArray(installResult.skipped) ? installResult.skipped.length : 0;
      const failed = Array.isArray(installResult.failed) ? installResult.failed.length : 0;
      const total = Number(installResult.total || installed + skipped + failed);
      lines.push(`result: total=${total} installed=${installed} skipped=${skipped} failed=${failed}`);
    }
    return lines.join("\n");
  }

  if (action === "cancel") {
    const installId = String(args[1] || "").trim();
    if (!installId) return "用法: /skills cancel <installId>";
    const { result, error } = await dispatchRpcForTelegram("skill_install_cancel", { installId });
    if (error) return `skills cancel 失败: ${error}`;
    const data = (result ?? {}) as { cancelled?: boolean; existed?: boolean };
    return `已取消 installId=${installId} cancelled=${data.cancelled ? "true" : "false"} existed=${data.existed ? "true" : "false"}`;
  }

  if (action === "commit") {
    const installId = String(args[1] || "").trim();
    if (!installId) {
      return "用法: /skills commit <installId> <all|name|id|index...> [--skip|--overwrite|--rename]";
    }
    const rawSelectors = args
      .slice(2)
      .join(" ")
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (rawSelectors.length === 0) {
      return "请指定选择项，例如: /skills commit <installId> all 或 /skills commit <installId> 1,2";
    }
    let conflictPolicy: "skip" | "overwrite" | "rename" | undefined;
    const selectorTokens: string[] = [];
    for (const token of rawSelectors) {
      const lower = token.toLowerCase();
      if (lower === "--skip" || lower === "skip") {
        conflictPolicy = "skip";
        continue;
      }
      if (lower === "--overwrite" || lower === "overwrite") {
        conflictPolicy = "overwrite";
        continue;
      }
      if (lower === "--rename" || lower === "rename") {
        conflictPolicy = "rename";
        continue;
      }
      selectorTokens.push(token);
    }
    if (selectorTokens.length === 0) selectorTokens.push("all");

    let selected = [...selectorTokens];
    if (selectorTokens.some((item) => /^\d+$/.test(item))) {
      const { result: statusResult, error: statusError } = await dispatchRpcForTelegram("skill_install_status", { installId });
      if (statusError) return `skills status 失败: ${statusError}`;
      const statusData = (statusResult ?? {}) as {
        candidates?: Array<{ id?: string; name?: string; path?: string }>;
      };
      const candidates = Array.isArray(statusData.candidates) ? statusData.candidates : [];
      const mapped: string[] = [];
      for (const token of selectorTokens) {
        if (!/^\d+$/.test(token)) {
          mapped.push(token);
          continue;
        }
        const index = Number(token) - 1;
        if (Number.isNaN(index) || index < 0 || index >= candidates.length) continue;
        const id = String(candidates[index]?.id || "").trim();
        if (id) mapped.push(id);
      }
      selected = mapped.length > 0 ? mapped : selectorTokens;
    }

    const { result, error } = await dispatchRpcForTelegram("skill_install_commit", {
      installId,
      selected,
      conflictPolicy,
    });
    if (error) return `skills commit 失败: ${error}`;
    const data = (result ?? {}) as {
      installed?: Array<{ name?: string; targetPath?: string }>;
      skipped?: Array<{ name?: string; warning?: string }>;
      failed?: Array<{ name?: string; error?: string }>;
      total?: number;
    };
    const installed = Array.isArray(data.installed) ? data.installed : [];
    const skipped = Array.isArray(data.skipped) ? data.skipped : [];
    const failed = Array.isArray(data.failed) ? data.failed : [];
    const total = Number(data.total || installed.length + skipped.length + failed.length);
    const lines = [
      `skills commit 完成 installId=${installId}`,
      `total=${total} installed=${installed.length} skipped=${skipped.length} failed=${failed.length}`,
    ];
    for (const item of installed.slice(0, 8)) {
      lines.push(`+ installed: ${String(item.name || "unknown")} -> ${String(item.targetPath || "")}`);
    }
    for (const item of skipped.slice(0, 8)) {
      lines.push(`- skipped: ${String(item.name || "unknown")} (${String(item.warning || "target_exists")})`);
    }
    for (const item of failed.slice(0, 8)) {
      lines.push(`! failed: ${String(item.name || "unknown")} (${String(item.error || "unknown")})`);
    }
    return lines.join("\n");
  }

  const { result, error } = await dispatchRpcForTelegram("list_skills", {});
  if (error) return `skills 查询失败: ${error}`;
  const items = Array.isArray(result) ? result as Array<Record<string, unknown>> : [];
  if (items.length === 0) return "暂无可用 skills";

  const pageSizeRaw = Number(process.env.YUANIO_TELEGRAM_SKILLS_PAGE_SIZE || "");
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(30, Math.max(6, Math.floor(pageSizeRaw)))
    : 12;
  let requestedPage = 1;
  if (action === "page") {
    const pageNum = Number(args[1] || "");
    if (Number.isFinite(pageNum) && pageNum > 0) requestedPage = Math.floor(pageNum);
  } else {
    for (let i = 1; i < args.length; i += 1) {
      const token = args[i].trim().toLowerCase();
      if (token === "--page" && i + 1 < args.length) {
        const pageNum = Number(args[i + 1]);
        if (Number.isFinite(pageNum) && pageNum > 0) requestedPage = Math.floor(pageNum);
        i += 1;
        continue;
      }
      if (token.startsWith("--page=")) {
        const pageNum = Number(token.slice("--page=".length));
        if (Number.isFinite(pageNum) && pageNum > 0) requestedPage = Math.floor(pageNum);
        continue;
      }
      if (/^\d+$/.test(token)) {
        const pageNum = Number(token);
        if (Number.isFinite(pageNum) && pageNum > 0) requestedPage = Math.floor(pageNum);
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const lines = [
    `Skills（第 ${page}/${totalPages} 页，共 ${items.length} 项）`,
    "提示: /skills install <source> [--scope project|user]",
  ];
  for (const item of pageItems) {
    const name = String(item.name || item.id || "unknown");
    const desc = String(item.description || "").trim();
    const scope = String(item.scope || "project");
    lines.push(`- /${name} (${scope})${desc ? `: ${desc}` : ""}`);
  }
  if (totalPages > 1) {
    lines.push("翻页: /skills page <n> 或点击下方按钮");
  }
  return {
    text: lines.join("\n"),
    page,
    totalPages,
  };
}
