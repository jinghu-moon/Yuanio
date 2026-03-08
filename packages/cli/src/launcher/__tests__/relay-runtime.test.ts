import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRelayLaunchEnv } from "../relay-runtime";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "yuanio-launcher-env-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"] }, null, 2));
  return root;
}

describe("resolveRelayLaunchEnv", () => {
  it("从 .env 加载 JWT_SECRET 并注入 PORT", () => {
    const root = makeWorkspace();
    try {
      writeFileSync(join(root, ".env"), "JWT_SECRET=launch-secret-1234567890-123456789\n");
      const result = resolveRelayLaunchEnv({ env: {}, port: 4010, repoRoot: root, homeDir: join(root, "home") });
      expect(result.env.JWT_SECRET).toBe("launch-secret-1234567890-123456789");
      expect(result.env.PORT).toBe("4010");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("缺少 JWT_SECRET 时直接抛出可读错误", () => {
    const root = makeWorkspace();
    try {
      expect(() => resolveRelayLaunchEnv({ env: {}, port: 4010, repoRoot: root, homeDir: join(root, "home") })).toThrow(/JWT_SECRET/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
