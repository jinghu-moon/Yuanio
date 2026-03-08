import type { AgentType } from "../spawn";
import type { IngressPromptSource } from "@yuanio/shared";

export type RegistryTaskStatus = "running" | "completed" | "error" | "stopped";

export interface RegistryTaskItem {
  taskId: string;
  promptId: string;
  agent: AgentType;
  source: IngressPromptSource;
  status: RegistryTaskStatus;
  promptPreview: string;
  startedAt: number;
  endedAt?: number;
  error?: string;
  outputLines: string[];
}

function previewPrompt(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "(empty)";
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

export function createTaskRegistry(options?: { maxHistory?: number; maxOutputLines?: number }) {
  const maxHistory = Math.max(20, Math.floor(options?.maxHistory || 160));
  const maxOutputLines = Math.max(30, Math.floor(options?.maxOutputLines || 300));
  const tasks = new Map<string, RegistryTaskItem>();
  const history: string[] = [];
  const stoppers = new Map<string, () => void>();

  const pushHistory = (taskId: string) => {
    history.push(taskId);
    if (history.length <= maxHistory) return;
    while (history.length > maxHistory) {
      const removed = history.shift();
      if (!removed) break;
      const item = tasks.get(removed);
      if (!item || item.status !== "running") {
        tasks.delete(removed);
        stoppers.delete(removed);
      }
    }
  };

  return {
    start(input: {
      taskId: string;
      promptId: string;
      prompt: string;
      agent: AgentType;
      source?: IngressPromptSource;
    }) {
      const item: RegistryTaskItem = {
        taskId: input.taskId,
        promptId: input.promptId,
        promptPreview: previewPrompt(input.prompt),
        agent: input.agent,
        source: input.source || "unknown",
        status: "running",
        startedAt: Date.now(),
        outputLines: [],
      };
      tasks.set(item.taskId, item);
      pushHistory(item.taskId);
      return item;
    },

    attachStopper(taskId: string, stopper: () => void) {
      if (!taskId || typeof stopper !== "function") return;
      stoppers.set(taskId, stopper);
    },

    appendOutput(taskId: string, text: string) {
      const item = tasks.get(taskId);
      if (!item) return;
      const clean = text.trimEnd();
      if (!clean) return;
      const lines = clean.split(/\r?\n/).filter(Boolean);
      item.outputLines.push(...lines);
      if (item.outputLines.length > maxOutputLines) {
        item.outputLines.splice(0, item.outputLines.length - maxOutputLines);
      }
    },

    finish(taskId: string, status: RegistryTaskStatus, error?: string) {
      const item = tasks.get(taskId);
      if (!item) return;
      item.status = status;
      item.endedAt = Date.now();
      item.error = error;
      stoppers.delete(taskId);
    },

    stop(taskId: string): boolean {
      const item = tasks.get(taskId);
      if (!item || item.status !== "running") return false;
      const stopper = stoppers.get(taskId);
      if (!stopper) return false;
      try {
        stopper();
      } catch {
        return false;
      }
      item.status = "stopped";
      item.endedAt = Date.now();
      stoppers.delete(taskId);
      return true;
    },

    get(taskId: string): RegistryTaskItem | null {
      const item = tasks.get(taskId);
      if (!item) return null;
      return {
        ...item,
        outputLines: [...item.outputLines],
      };
    },

    list(limit = 30): RegistryTaskItem[] {
      const items: RegistryTaskItem[] = [];
      for (const taskId of [...history].reverse()) {
        const item = tasks.get(taskId);
        if (item) items.push({ ...item, outputLines: [...item.outputLines] });
        if (items.length >= Math.max(1, limit)) break;
      }
      return items;
    },

    running(): RegistryTaskItem[] {
      return this.list(maxHistory).filter((item) => item.status === "running");
    },
  };
}
