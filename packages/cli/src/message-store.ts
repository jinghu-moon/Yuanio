import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

// ── 类型 ──

export interface StoredMessage {
  id: string;
  sessionId: string;
  seq: number;
  content: string;   // JSON string
  role: string;
  createdAt: number;
}

// ── MessageStore ──

export class MessageStore {
  private db: Database;
  private seqMap = new Map<string, number>();

  constructor(db: Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        content TEXT NOT NULL,
        role TEXT DEFAULT 'agent',
        created_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_msg_session_seq ON messages(session_id, seq)`);
  }

  private nextSeq(sessionId: string): number {
    const current = this.seqMap.get(sessionId);
    if (current !== undefined) {
      const next = current + 1;
      this.seqMap.set(sessionId, next);
      return next;
    }
    // 从 DB 加载最大 seq
    const row = this.db.query(
      `SELECT MAX(seq) as maxSeq FROM messages WHERE session_id = ?`,
    ).get(sessionId) as { maxSeq: number | null } | null;
    const next = (row?.maxSeq ?? 0) + 1;
    this.seqMap.set(sessionId, next);
    return next;
  }

  /** 添加消息 */
  addMessage(sessionId: string, content: string, role = "agent"): StoredMessage {
    const id = randomUUID();
    const seq = this.nextSeq(sessionId);
    const createdAt = Date.now();

    this.db.run(
      `INSERT INTO messages (id, session_id, seq, content, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, sessionId, seq, content, role, createdAt],
    );

    return { id, sessionId, seq, content, role, createdAt };
  }

  /** 向前分页：获取 beforeSeq 之前的消息 */
  getMessages(sessionId: string, limit = 50, beforeSeq?: number): StoredMessage[] {
    const safeLimit = Math.min(Math.max(1, limit), 200);

    if (beforeSeq !== undefined) {
      return this.db.query(
        `SELECT id, session_id as sessionId, seq, content, role, created_at as createdAt
         FROM messages WHERE session_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?`,
      ).all(sessionId, beforeSeq, safeLimit) as StoredMessage[];
    }

    return this.db.query(
      `SELECT id, session_id as sessionId, seq, content, role, created_at as createdAt
       FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?`,
    ).all(sessionId, safeLimit) as StoredMessage[];
  }

  /** 增量拉取：获取 afterSeq 之后的消息 */
  getMessagesAfter(sessionId: string, afterSeq: number, limit = 50): StoredMessage[] {
    const safeLimit = Math.min(Math.max(1, limit), 200);
    return this.db.query(
      `SELECT id, session_id as sessionId, seq, content, role, created_at as createdAt
       FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    ).all(sessionId, afterSeq, safeLimit) as StoredMessage[];
  }

  /** 获取会话消息总数 */
  getMessageCount(sessionId: string): number {
    const row = this.db.query(
      `SELECT COUNT(*) as c FROM messages WHERE session_id = ?`,
    ).get(sessionId) as { c: number } | null;
    return row?.c ?? 0;
  }

  /** 删除会话所有消息 */
  deleteSessionMessages(sessionId: string): number {
    const count = this.getMessageCount(sessionId);
    this.db.run(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
    this.seqMap.delete(sessionId);
    return count;
  }
}
