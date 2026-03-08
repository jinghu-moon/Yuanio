import { spawnAgent } from "./spawn";
import type { AgentType, AgentHandle } from "./spawn";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const YUANIO_DIR = `${process.env.HOME || process.env.USERPROFILE}/.yuanio`;
const SESSIONS_FILE = join(YUANIO_DIR, "sessions.json");

// ── 类型 ──

export interface TrackedSession {
  id: string;
  pid: number;
  agent: AgentType;
  directory: string;
  startedAt: number;
  handle?: AgentHandle;
  // Phase 7: 版本控制
  metadataVersion: number;
  agentStateVersion: number;
  activeAt: number;
  thinking: boolean;
}

interface PersistedSession {
  id: string;
  pid: number;
  agent: string;
  directory: string;
  startedAt: number;
}

// ── SessionManager ──

export class SessionManager {
  private sessions = new Map<string, TrackedSession>();
  private sessionSeq = 0;

  constructor() {
    mkdirSync(YUANIO_DIR, { recursive: true });
  }

  /** 从磁盘加载持久化会话 */
  load(): void {
    try {
      if (!existsSync(SESSIONS_FILE)) return;
      const data: PersistedSession[] = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
      for (const s of data) {
        this.sessions.set(s.id, {
          id: s.id,
          pid: s.pid,
          agent: s.agent as AgentType,
          directory: s.directory,
          startedAt: s.startedAt,
          metadataVersion: 0,
          agentStateVersion: 0,
          activeAt: s.startedAt,
          thinking: false,
        });
      }
    } catch {
      // 文件损坏，忽略
    }
  }

  /** 持久化到磁盘 */
  private persist(): void {
    const data: PersistedSession[] = Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      pid: s.pid,
      agent: s.agent,
      directory: s.directory,
      startedAt: s.startedAt,
    }));
    writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  }

  /** 启动新会话（支持恢复） */
  spawn(
    directory: string,
    agent: AgentType = "claude",
    prompt = "你好，新会话已启动。",
    resumeSessionId?: string,
  ): TrackedSession {
    const id = `session_${++this.sessionSeq}_${Date.now()}`;
    const handle = spawnAgent(prompt, () => {}, { agent, resumeSessionId });
    const pid = handle.pid ?? process.pid;

    const session: TrackedSession = {
      id,
      pid,
      agent,
      directory,
      startedAt: Date.now(),
      handle,
      metadataVersion: 1,
      agentStateVersion: 1,
      activeAt: Date.now(),
      thinking: false,
    };

    this.sessions.set(id, session);
    this.persist();

    // 会话结束时自动清理
    handle.promise
      .catch(() => {})
      .finally(() => {
        const s = this.sessions.get(id);
        if (s) {
          delete s.handle;
          this.persist();
        }
      });

    return session;
  }

  /** 停止会话 */
  stop(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.handle) {
      session.handle.kill();
      delete session.handle;
    }

    this.sessions.delete(sessionId);
    this.persist();
    return true;
  }

  /** 列出所有追踪的会话 */
  list(): Array<{
    sessionId: string;
    pid: number;
    agent: string;
    directory: string;
    startedAt: number;
    status: "running" | "stopped";
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      sessionId: s.id,
      pid: s.pid,
      agent: s.agent,
      directory: s.directory,
      startedAt: s.startedAt,
      status: s.handle ? "running" as const : "stopped" as const,
    }));
  }

  /** 检查 PID 是否存活 */
  isAlive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.handle) return true;
    try {
      process.kill(session.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 清理已退出的会话 */
  pruneDeadSessions(): number {
    let pruned = 0;
    for (const [id, session] of this.sessions) {
      if (!session.handle && !this.isAlive(id)) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) this.persist();
    return pruned;
  }

  // ── Phase 7: 版本控制方法 ──

  /** 乐观锁更新元数据 */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>, expectedVersion: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.metadataVersion !== expectedVersion) return false;
    session.metadataVersion++;
    Object.assign(session, metadata);
    this.persist();
    return true;
  }

  /** 乐观锁更新 Agent 状态 */
  updateAgentState(sessionId: string, _state: Record<string, unknown>, expectedVersion: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.agentStateVersion !== expectedVersion) return false;
    session.agentStateVersion++;
    this.persist();
    return true;
  }

  /** 标记会话活跃 */
  markActive(sessionId: string, thinking?: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.activeAt = Date.now();
    if (thinking !== undefined) session.thinking = thinking;
  }

  /** 标记会话不活跃 */
  markInactive(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.thinking = false;
  }

  /** 清理超时会话 */
  expireInactive(timeoutMs = 30_000): string[] {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, session] of this.sessions) {
      if (now - session.activeAt > timeoutMs && !session.handle) {
        this.sessions.delete(id);
        expired.push(id);
      }
    }
    if (expired.length > 0) this.persist();
    return expired;
  }

  /** 获取会话（供外部读取版本号） */
  get(sessionId: string): TrackedSession | undefined {
    return this.sessions.get(sessionId);
  }
}
