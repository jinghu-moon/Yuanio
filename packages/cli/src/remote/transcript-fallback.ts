import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveTranscriptPath(): string | null {
  const envPath = process.env.YUANIO_TRANSCRIPT_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const hintFile = join(homedir(), ".claude", "telegram_transcript_path");
  if (!existsSync(hintFile)) return null;
  try {
    const path = readFileSync(hintFile, "utf-8").trim();
    if (path && existsSync(path)) return path;
  } catch {
    return null;
  }
  return null;
}

function extractAssistantTexts(record: any): string[] {
  const content = record?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
    .map((part: any) => String(part.text));
}

/**
 * 当 stream-json 执行异常时，尝试从 Claude transcript 中提取最近一轮 assistant 输出作为兜底。
 */
export function readTranscriptFallback(maxChars = 4000): string | null {
  const transcriptPath = resolveTranscriptPath();
  if (!transcriptPath) return null;

  try {
    const raw = readFileSync(transcriptPath, "utf-8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return null;

    const records: any[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // ignore malformed line
      }
    }
    if (records.length === 0) return null;

    let lastUserIndex = -1;
    for (let i = 0; i < records.length; i += 1) {
      if (records[i]?.type === "user") lastUserIndex = i;
    }
    if (lastUserIndex < 0) return null;

    const chunks: string[] = [];
    for (let i = lastUserIndex + 1; i < records.length; i += 1) {
      const rec = records[i];
      if (rec?.type !== "assistant") continue;
      const texts = extractAssistantTexts(rec);
      if (texts.length > 0) chunks.push(...texts);
    }
    if (chunks.length === 0) return null;

    const joined = chunks.join("\n\n").trim();
    if (!joined) return null;
    return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n...(fallback truncated)` : joined;
  } catch {
    return null;
  }
}
