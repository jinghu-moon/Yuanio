import { describe, it, expect } from "bun:test";
import { loadTemplates, saveTemplate, deleteTemplate } from "../templates";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("templates", () => {
  it("save/load/delete", () => {
    const dir = mkdtempSync(join(tmpdir(), "yuanio-templates-"));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      saveTemplate("alpha", "one");
      const templates = loadTemplates();
      expect(templates.alpha).toBe("one");
      expect(existsSync(join(dir, ".yuanio", "templates.json"))).toBe(true);
      deleteTemplate("alpha");
      expect(loadTemplates().alpha).toBeUndefined();
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
