import { describe, expect, it } from "bun:test";
import { renderMarkdownToTelegramHtml } from "../telegram-markdown";

describe("telegram-markdown", () => {
  it("渲染行内代码", () => {
    const html = renderMarkdownToTelegramHtml("请执行 `bun run typecheck`");
    expect(html).toContain("<code>bun run typecheck</code>");
  });

  it("渲染 fenced code block", () => {
    const md = "```bash\nbun run packages/cli/src/index.ts --server http://127.0.0.1:3000\n```";
    const html = renderMarkdownToTelegramHtml(md);
    expect(html).toContain("<pre><code class=\"language-bash\">");
    expect(html).toContain("bun run packages/cli/src/index.ts --server http://127.0.0.1:3000");
    expect(html).toContain("</code></pre>");
  });

  it("渲染强调、删除线、链接", () => {
    const md = "**bold** _italic_ ~~del~~ [link](https://example.com)";
    const html = renderMarkdownToTelegramHtml(md);
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i>italic</i>");
    expect(html).toContain("<s>del</s>");
    expect(html).toContain("<a href=\"https://example.com\">link</a>");
  });

  it("渲染列表与引用", () => {
    const md = [
      "- alpha",
      "- [x] done",
      "1. one",
      "> quote",
    ].join("\n");
    const html = renderMarkdownToTelegramHtml(md);
    expect(html).toContain("• alpha");
    expect(html).toContain("☑ done");
    expect(html).toContain("1. one");
    expect(html).toContain("<blockquote>quote</blockquote>");
  });

  it("表格回退为 pre", () => {
    const md = [
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const html = renderMarkdownToTelegramHtml(md);
    expect(html).toContain("<pre>");
    expect(html).toContain("| a | b |");
    expect(html).toContain("</pre>");
  });
});

