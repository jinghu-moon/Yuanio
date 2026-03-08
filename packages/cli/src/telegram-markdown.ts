function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function sanitizeLang(langRaw: string): string {
  const cleaned = (langRaw || "").trim().toLowerCase();
  if (!cleaned) return "";
  return /^[a-z0-9_+\-]{1,32}$/i.test(cleaned) ? cleaned : "";
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function extractFencedCodeBlocks(input: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const text = input.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_m, langRaw, codeRaw) => {
    const lang = sanitizeLang(String(langRaw || ""));
    const code = String(codeRaw || "").replace(/\n$/, "");
    const body = lang
      ? `<pre><code class="language-${escapeAttr(lang)}">${escapeHtml(code)}</code></pre>`
      : `<pre>${escapeHtml(code)}</pre>`;
    const token = `§§TGCODEBLOCK${blocks.length}§§`;
    blocks.push(body);
    return token;
  });
  return { text, blocks };
}

function extractInlineCode(input: string): { text: string; inlineCodes: string[] } {
  const inlineCodes: string[] = [];
  const text = input.replace(/`([^`\n]+?)`/g, (_m, codeRaw) => {
    const token = `§§TGINLINECODE${inlineCodes.length}§§`;
    inlineCodes.push(`<code>${escapeHtml(String(codeRaw))}</code>`);
    return token;
  });
  return { text, inlineCodes };
}

function restoreTokens(input: string, blocks: string[], inlineCodes: string[]): string {
  let text = input;
  for (let i = 0; i < blocks.length; i++) {
    text = text.replaceAll(`§§TGCODEBLOCK${i}§§`, blocks[i] || "");
  }
  for (let i = 0; i < inlineCodes.length; i++) {
    text = text.replaceAll(`§§TGINLINECODE${i}§§`, inlineCodes[i] || "");
  }
  return text;
}

function renderInline(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const { text: noInlineCode, inlineCodes } = extractInlineCode(escaped);

  let text = noInlineCode;
  text = text.replace(/!\[([^\]]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, url) => {
    const safeAlt = String(alt || "").trim();
    const label = safeAlt ? `🖼 ${safeAlt}` : "🖼 image";
    return `<a href="${escapeAttr(String(url))}">${label}</a>`;
  });
  text = text.replace(/\[([^\]]+?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label, url) => (
    `<a href="${escapeAttr(String(url))}">${String(label)}</a>`
  ));
  text = text.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (_m, url) => `<a href="${escapeAttr(String(url))}">${String(url)}</a>`);
  text = text.replace(/\|\|(.+?)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  text = text.replace(/(^|[^\*])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1<i>$2</i>");
  text = text.replace(/(^|[^_])_(?!\s)(.+?)(?<!\s)_(?!_)/g, "$1<i>$2</i>");

  return restoreTokens(text, [], inlineCodes);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/.test(line);
}

function renderBlocks(markdown: string): string {
  const lines = normalizeNewlines(markdown).split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] || "";
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      out.push("");
      i += 1;
      continue;
    }

    // Markdown table -> code block fallback (Telegram does not support table tags).
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] || "")) {
      const tableLines = [line];
      i += 1;
      while (i < lines.length) {
        const row = (lines[i] || "").trimEnd();
        if (!row.trim()) break;
        if (!row.includes("|") && !isTableSeparator(row)) break;
        tableLines.push(row);
        i += 1;
      }
      out.push(`<pre>${escapeHtml(tableLines.join("\n"))}</pre>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      out.push(`<b>${renderInline(headingMatch[2] || "")}</b>`);
      i += 1;
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      out.push("────────");
      i += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const q = (lines[i] || "").trimEnd();
        if (!q.trim()) break;
        if (!/^>\s?/.test(q.trim())) break;
        quoteLines.push(q.trim().replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${quoteLines.map((s) => renderInline(s)).join("\n")}</blockquote>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.+)$/);
    if (unordered) {
      const checked = String(unordered[1]).toLowerCase() === "x";
      out.push(`${checked ? "☑" : "☐"} ${renderInline(unordered[2] || "")}`);
      i += 1;
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      out.push(`• ${renderInline(bullet[1] || "")}`);
      i += 1;
      continue;
    }

    const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      out.push(`${ordered[1]}. ${renderInline(ordered[2] || "")}`);
      i += 1;
      continue;
    }

    out.push(renderInline(line));
    i += 1;
  }

  return out.join("\n");
}

export function renderMarkdownToTelegramHtml(markdown: string): string {
  const normalized = normalizeNewlines(markdown || "");
  const { text, blocks } = extractFencedCodeBlocks(normalized);
  const rendered = renderBlocks(text);
  return restoreTokens(rendered, blocks, []);
}
