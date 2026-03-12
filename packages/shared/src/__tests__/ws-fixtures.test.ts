import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WsFrameSchema } from "../schemas";

type FixtureEntry = {
  name: string;
  frames: unknown[];
};

const fixturesDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

function loadFixtures(): FixtureEntry[] {
  if (!existsSync(fixturesDir)) return [];
  const files = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));
  return files.map((name) => {
    const content = readFileSync(join(fixturesDir, name), "utf-8");
    const parsed = JSON.parse(content);
    return {
      name,
      frames: Array.isArray(parsed) ? parsed : [],
    };
  });
}

describe("ws fixtures", () => {
  it("应包含 Claude/Codex/Gemini 三份 fixtures", () => {
    const fixtures = loadFixtures();
    const names = fixtures.map((item) => item.name);
    expect(names).toContain("ws-claude.json");
    expect(names).toContain("ws-codex.json");
    expect(names).toContain("ws-gemini.json");
  });

  it("每份 fixtures 都应为有效 WS frame 序列", () => {
    const fixtures = loadFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      for (const frame of fixture.frames) {
        WsFrameSchema.parse(frame);
      }
    }
  });
});
