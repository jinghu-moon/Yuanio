import type { TodoItem } from "@yuanio/shared";
import { randomUUID } from "node:crypto";

/**
 * 从 Agent 输出中提取 TodoWrite 工具调用
 * 支持 Claude 的 tool_use block 和 Codex 的 tool-call 格式
 */
export function extractTodosFromAgentOutput(content: unknown): TodoItem[] | null {
  if (!content || typeof content !== "object") return null;

  const todos: TodoItem[] = [];

  // Claude 格式: content 数组中的 tool_use block
  if (Array.isArray(content)) {
    for (const block of content) {
      const items = extractFromBlock(block);
      if (items) todos.push(...items);
    }
  }

  // 单个对象格式
  if (!Array.isArray(content)) {
    const items = extractFromBlock(content);
    if (items) todos.push(...items);
  }

  return todos.length > 0 ? todos : null;
}

function extractFromBlock(block: unknown): TodoItem[] | null {
  if (!block || typeof block !== "object") return null;
  const b = block as Record<string, unknown>;

  // Claude tool_use: { type: "tool_use", name: "TodoWrite", input: { todos: [...] } }
  if (b.type === "tool_use" && isTodoTool(b.name as string)) {
    return parseTodoInput(b.input);
  }

  // Codex tool-call: { type: "tool-call", tool: "TodoWrite", params: { todos: [...] } }
  if (b.type === "tool-call" && isTodoTool(b.tool as string)) {
    return parseTodoInput(b.params);
  }

  // tool_call event from dispatch: { tool: "TodoWrite", params: { todos: [...] } }
  if (isTodoTool(b.tool as string) && b.params) {
    return parseTodoInput(b.params);
  }

  return null;
}

function isTodoTool(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  return lower === "todowrite" || lower === "todo_write" || lower === "todoupdate";
}

function parseTodoInput(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null;
  const inp = input as Record<string, unknown>;

  // { todos: [{ content, status, priority }] }
  const rawTodos = inp.todos;
  if (!Array.isArray(rawTodos)) return null;

  const items: TodoItem[] = [];
  for (const t of rawTodos) {
    if (!t || typeof t !== "object") continue;
    const todo = t as Record<string, unknown>;
    items.push({
      id: (todo.id as string) || randomUUID(),
      content: String(todo.content ?? ""),
      status: normalizeTodoStatus(todo.status),
      priority: normalizeTodoPriority(todo.priority),
    });
  }

  return items.length > 0 ? items : null;
}

function normalizeTodoStatus(v: unknown): TodoItem["status"] {
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower === "in_progress" || lower === "in-progress") return "in_progress";
    if (lower === "completed" || lower === "done") return "completed";
  }
  return "pending";
}

function normalizeTodoPriority(v: unknown): TodoItem["priority"] {
  if (typeof v === "string") {
    const lower = v.toLowerCase();
    if (lower === "high") return "high";
    if (lower === "low") return "low";
  }
  return "medium";
}
