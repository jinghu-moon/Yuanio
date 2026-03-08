import { saveAgentSpec, type AgentSpec } from "./agent-config";

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function saveAgentFromRecord(agent: Record<string, unknown>, cwd: string): AgentSpec {
  const name = String(agent.name || "").trim();
  const prompt = String(agent.prompt || "").trim();
  if (!name) throw new Error("agent.name is required");
  if (!prompt) throw new Error("agent.prompt is required");

  const description = String(agent.description || "").trim() || "(no description)";
  const memoryMode = (agent.memory === "user" || agent.memory === "project" || agent.memory === "local")
    ? agent.memory
    : undefined;
  const record: Omit<AgentSpec, "path"> = {
    name,
    description,
    prompt,
    tools: normalizeStringList(agent.tools),
    disallowedTools: normalizeStringList(agent.disallowedTools),
    model: typeof agent.model === "string" ? agent.model.trim() : undefined,
    permissionMode: typeof agent.permissionMode === "string" ? agent.permissionMode.trim() : undefined,
    memory: memoryMode as AgentSpec["memory"],
    background: typeof agent.background === "boolean" ? agent.background : undefined,
    isolation: agent.isolation === "worktree" ? "worktree" as const : undefined,
    maxTurns: Number.isFinite(Number(agent.maxTurns)) ? Math.max(1, Math.floor(Number(agent.maxTurns))) : undefined,
  };
  return saveAgentSpec(record, cwd);
}
