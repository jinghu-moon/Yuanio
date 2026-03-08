import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRelayRuntimeEnv,
  validateRelayRuntimeEnv,
  requireRelayJwtSecret,
} from "./relay-runtime-env";

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "yuanio-relay-env-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"] }, null, 2));
  return root;
}

describe("relay runtime env", () => {
  it("从工作区 .env 加载 JWT_SECRET", () => {
    const root = makeWorkspace();
    try {
      writeFileSync(join(root, ".env"), "JWT_SECRET=file-secret-1234567890-1234567890\n");
      const result = loadRelayRuntimeEnv({ env: {}, startDir: root, homeDir: join(root, "home") });
      expect(result.env.JWT_SECRET).toBe("file-secret-1234567890-1234567890");
      expect(result.sources.some((item) => item.endsWith(".env"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("进程环境变量优先于文件", () => {
    const root = makeWorkspace();
    try {
      writeFileSync(join(root, ".env"), "JWT_SECRET=file-secret-1234567890-1234567890\n");
      const result = loadRelayRuntimeEnv({
        env: { JWT_SECRET: "process-secret-1234567890-123456" },
        startDir: root,
        homeDir: join(root, "home"),
      });
      expect(result.env.JWT_SECRET).toBe("process-secret-1234567890-123456");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("支持用户目录 runtime.env 兜底", () => {
    const root = makeWorkspace();
    const homeDir = join(root, "home");
    try {
      mkdirSync(join(homeDir, ".yuanio"), { recursive: true });
      writeFileSync(join(homeDir, ".yuanio", "runtime.env"), "JWT_SECRET=home-secret-1234567890-1234567890\n");
      const secret = requireRelayJwtSecret({ env: {}, startDir: root, homeDir });
      expect(secret).toBe("home-secret-1234567890-1234567890");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("缺少密钥时返回校验错误", () => {
    const root = makeWorkspace();
    try {
      const errors = validateRelayRuntimeEnv({ env: {}, startDir: root, homeDir: join(root, "home") });
      expect(errors).toContain("JWT_SECRET is required");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
