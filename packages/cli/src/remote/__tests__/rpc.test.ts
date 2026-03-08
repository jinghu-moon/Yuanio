import { describe, it, expect } from "bun:test";
import { handleRpc } from "../rpc";
import { MessageType } from "@yuanio/shared";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { resetSkillInstallSessionsForTest } from "../skill-install-engine";

const withEnv = async (key: string, value: string | undefined, fn: () => Promise<void>) => {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
};

describe("rpc", () => {
  it("foreground_probe 返回实时快照", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };
    await handleRpc({
      id: "fp1",
      method: "foreground_probe",
      params: {},
    }, {
      sendEnvelope,
      getForegroundProbe: () => ({
        sessionId: "sess_x",
        status: "running",
        cwd: "/tmp/demo",
        turnStateVersion: 3,
      }),
    });

    const resp = JSON.parse(sent[0].payload) as { result?: Record<string, unknown> };
    expect(resp.result?.sessionId).toBe("sess_x");
    expect(resp.result?.status).toBe("running");
    expect(resp.result?.turnStateVersion).toBe(3);
    expect(typeof resp.result?.serverTs).toBe("number");
  });

  it("readonly 阻止写入操作", async () => {
    await withEnv("YUANIO_RPC_MODE", "readonly", async () => {
      const sent: { type: MessageType; payload: string }[] = [];
      const sendEnvelope = async (type: MessageType, plaintext: string) => {
        sent.push({ type, payload: plaintext });
      };
      await handleRpc({
        id: "1",
        method: "write_file",
        params: { path: "./tmp.txt", content: "x" },
      }, { sendEnvelope });

      const resp = JSON.parse(sent[0].payload) as { error?: string };
      expect(resp.error).toContain("readonly");
    });
  });

  it("rpc root 限制路径", async () => {
    const root = mkdtempSync(join(tmpdir(), "yuanio-rpc-root-"));
    try {
      await withEnv("YUANIO_RPC_ROOT", root, async () => {
        const sent: { type: MessageType; payload: string }[] = [];
        const sendEnvelope = async (type: MessageType, plaintext: string) => {
          sent.push({ type, payload: plaintext });
        };
        const outside = process.cwd();
        await handleRpc({
          id: "2",
          method: "read_file",
          params: { path: outside },
        }, { sendEnvelope });

        const resp = JSON.parse(sent[0].payload) as { error?: string };
        expect(resp.error).toContain("rpc root");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rpc root 内允许读取", async () => {
    const root = mkdtempSync(join(tmpdir(), "yuanio-rpc-root-"));
    const filePath = join(root, "sample.txt");
    writeFileSync(filePath, "hello");
    try {
      await withEnv("YUANIO_RPC_ROOT", root, async () => {
        const sent: { type: MessageType; payload: string }[] = [];
        const sendEnvelope = async (type: MessageType, plaintext: string) => {
          sent.push({ type, payload: plaintext });
        };
        await handleRpc({
          id: "3",
          method: "read_file",
          params: { path: filePath },
        }, { sendEnvelope });

        const resp = JSON.parse(sent[0].payload) as { result?: string; error?: string };
        expect(resp.error).toBeUndefined();
        expect(resp.result).toBe("hello");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allowlist 限制 rpc 方法", async () => {
    await withEnv("YUANIO_RPC_ALLOW", "read_file,ls", async () => {
      const sent: { type: MessageType; payload: string }[] = [];
      const sendEnvelope = async (type: MessageType, plaintext: string) => {
        sent.push({ type, payload: plaintext });
      };
      await handleRpc({
        id: "4",
        method: "git_status",
        params: {},
      }, { sendEnvelope });

      const resp = JSON.parse(sent[0].payload) as { error?: string };
      expect(resp.error).toContain("not allowed");
    });
  });

  it("upload_* + download_file 可完成二进制文件上传与下载", async () => {
    const root = mkdtempSync(join(tmpdir(), "yuanio-rpc-upload-"));
    try {
      await withEnv("YUANIO_RPC_ROOT", root, async () => {
        const sent: { type: MessageType; payload: string }[] = [];
        const sendEnvelope = async (type: MessageType, plaintext: string) => {
          sent.push({ type, payload: plaintext });
        };

        await handleRpc({
          id: "u1",
          method: "upload_init",
          params: {
            targetDir: ".",
            fileName: "demo.bin",
            totalBytes: 5,
            conflictPolicy: "overwrite",
          },
        }, { sendEnvelope });
        const initResp = JSON.parse(sent.pop()!.payload) as { result?: { uploadId: string } };
        const uploadId = initResp.result?.uploadId;
        expect(uploadId).toBeTruthy();

        const chunkBase64 = Buffer.from(new Uint8Array([1, 2, 3, 4, 5])).toString("base64");
        await handleRpc({
          id: "u2",
          method: "upload_chunk",
          params: { uploadId, offset: 0, chunkBase64 },
        }, { sendEnvelope });
        const chunkResp = JSON.parse(sent.pop()!.payload) as { result?: { accepted: boolean; nextOffset: number } };
        expect(chunkResp.result?.accepted).toBe(true);
        expect(chunkResp.result?.nextOffset).toBe(5);

        await handleRpc({
          id: "u3",
          method: "upload_commit",
          params: { uploadId, promptText: "请分析这张图", ephemeral: true, cleanupAfterMs: 60_000 },
        }, { sendEnvelope });
        const commitResp = JSON.parse(sent.pop()!.payload) as {
          result?: {
            committed: boolean;
            path: string;
            promptRef: string;
            suggestedPrompt: string;
            cleanupScheduledMs: number | null;
          };
        };
        expect(commitResp.result?.committed).toBe(true);
        expect(commitResp.result?.path).toContain("demo.bin");
        expect(commitResp.result?.promptRef).toContain("@");
        expect(commitResp.result?.suggestedPrompt).toContain("请分析这张图");
        expect((commitResp.result?.cleanupScheduledMs ?? 0) > 0).toBe(true);

        await handleRpc({
          id: "u4",
          method: "download_file",
          params: { path: "demo.bin" },
        }, { sendEnvelope });
        const downloadResp = JSON.parse(sent.pop()!.payload) as { result?: { contentBase64: string } };
        const bytes = Buffer.from(downloadResp.result?.contentBase64 ?? "", "base64");
        expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("list_dirs + change_cwd 可浏览并切换目录", async () => {
    const root = mkdtempSync(join(tmpdir(), "yuanio-rpc-cwd-"));
    const subDir = join(root, "workspace-a");
    const originalCwd = process.cwd();
    try {
      mkdirSync(subDir, { recursive: true });
      await withEnv("YUANIO_RPC_ROOT", root, async () => {
        const sent: { type: MessageType; payload: string }[] = [];
        const sendEnvelope = async (type: MessageType, plaintext: string) => {
          sent.push({ type, payload: plaintext });
        };

        await handleRpc({
          id: "d1",
          method: "list_dirs",
          params: { path: "." },
        }, { sendEnvelope });
        const listResp = JSON.parse(sent.pop()!.payload) as {
          result?: { entries?: Array<{ name: string }> };
        };
        const names = (listResp.result?.entries ?? []).map((e) => e.name);
        expect(names.includes("workspace-a")).toBe(true);

        await handleRpc({
          id: "d2",
          method: "change_cwd",
          params: { path: "workspace-a" },
        }, { sendEnvelope });
        const cwdResp = JSON.parse(sent.pop()!.payload) as {
          result?: { changed: boolean; cwd: string };
        };
        expect(cwdResp.result?.changed).toBe(true);
        expect(cwdResp.result?.cwd).toBe(subDir);
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("get_execution_mode + set_execution_mode 可读写执行模式", async () => {
    let mode: "act" | "plan" = "act";
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleRpc({
      id: "m1",
      method: "get_execution_mode",
      params: {},
    }, {
      sendEnvelope,
      getExecutionMode: () => mode,
      setExecutionMode: async (next) => {
        mode = next;
        return `switched to ${next}`;
      },
    });
    const getResp1 = JSON.parse(sent.pop()!.payload) as { result?: { mode: string } };
    expect(getResp1.result?.mode).toBe("act");

    await handleRpc({
      id: "m2",
      method: "set_execution_mode",
      params: { mode: "plan" },
    }, {
      sendEnvelope,
      getExecutionMode: () => mode,
      setExecutionMode: async (next) => {
        mode = next;
        return `switched to ${next}`;
      },
    });
    const setResp = JSON.parse(sent.pop()!.payload) as { result?: { mode: string; message: string } };
    expect(setResp.result?.mode).toBe("plan");
    expect(setResp.result?.message).toContain("plan");

    await handleRpc({
      id: "m3",
      method: "get_execution_mode",
      params: {},
    }, {
      sendEnvelope,
      getExecutionMode: () => mode,
      setExecutionMode: async (next) => {
        mode = next;
        return `switched to ${next}`;
      },
    });
    const getResp2 = JSON.parse(sent.pop()!.payload) as { result?: { mode: string } };
    expect(getResp2.result?.mode).toBe("plan");
  });

  it("task_panel + list_checkpoints 返回扩展状态", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleRpc({
      id: "p1",
      method: "task_panel",
      params: {},
    }, {
      sendEnvelope,
      getTaskPanel: () => ({
        mode: "plan",
        runningCount: 2,
        queueSize: 3,
        pendingApprovals: 1,
        running: [
          { taskId: "task_1", agent: "codex" },
          { taskId: "task_2", agent: "claude" },
        ],
      }),
    });
    const panelResp = JSON.parse(sent.pop()!.payload) as {
      result?: { mode: string; runningCount: number; queueSize: number; pendingApprovals: number };
    };
    expect(panelResp.result?.mode).toBe("plan");
    expect(panelResp.result?.runningCount).toBe(2);
    expect(panelResp.result?.queueSize).toBe(3);
    expect(panelResp.result?.pendingApprovals).toBe(1);

    await handleRpc({
      id: "p2",
      method: "list_checkpoints",
      params: { limit: 5 },
    }, {
      sendEnvelope,
      listCheckpoints: () => [
        {
          id: "ckpt_20260305000000_task_1",
          taskId: "task_1",
          agent: "codex",
          promptPreview: "hello",
          source: "telegram",
          createdAt: Date.now(),
          cwd: process.cwd(),
          files: ["packages/cli/src/remote.ts"],
        },
      ],
    });
    const checkpointsResp = JSON.parse(sent.pop()!.payload) as {
      result?: { items?: Array<{ id: string }> };
    };
    expect(checkpointsResp.result?.items?.length).toBe(1);
    expect(checkpointsResp.result?.items?.[0]?.id).toContain("ckpt_");
  });

  it("扩展 RPC 方法（context/memory/task/skill）可工作", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleRpc({
      id: "x1",
      method: "context_usage",
      params: {},
    }, {
      sendEnvelope,
      getContextUsage: () => ({
        usedPercentage: 42,
        estimatedUsedTokens: 42000,
        contextWindowSize: 100000,
      }),
    });
    const contextResp = JSON.parse(sent.pop()!.payload) as {
      result?: { usedPercentage: number; estimatedUsedTokens: number };
    };
    expect(contextResp.result?.usedPercentage).toBe(42);
    expect(contextResp.result?.estimatedUsedTokens).toBe(42000);

    await handleRpc({
      id: "x2",
      method: "memory_toggle",
      params: { enabled: false },
    }, {
      sendEnvelope,
      setMemoryEnabled: (enabled) => enabled,
    });
    const memoryResp = JSON.parse(sent.pop()!.payload) as { result?: { enabled: boolean } };
    expect(memoryResp.result?.enabled).toBe(false);

    await handleRpc({
      id: "x3",
      method: "list_tasks",
      params: { limit: 10 },
    }, {
      sendEnvelope,
      listTasks: () => [
        { taskId: "task_1", status: "running" },
      ],
    });
    const tasksResp = JSON.parse(sent.pop()!.payload) as {
      result?: { items?: Array<{ taskId: string }> };
    };
    expect(tasksResp.result?.items?.[0]?.taskId).toBe("task_1");

    await handleRpc({
      id: "x4",
      method: "invoke_skill",
      params: { name: "review", args: "README.md" },
    }, {
      sendEnvelope,
      invokeSkill: async (name, args) => ({
        invoked: true,
        name,
        args,
      }),
    });
    const skillResp = JSON.parse(sent.pop()!.payload) as {
      result?: { invoked: boolean; name: string; args: string };
    };
    expect(skillResp.result?.invoked).toBe(true);
    expect(skillResp.result?.name).toBe("review");
    expect(skillResp.result?.args).toBe("README.md");
  });

  it("skill_install_prepare 可扫描多技能并补齐 description", async () => {
    resetSkillInstallSessionsForTest();
    const root = mkdtempSync(join(tmpdir(), "yuanio-rpc-skill-prepare-"));
    const sourceRoot = join(root, "skills-source");
    const alphaDir = join(sourceRoot, "alpha");
    const betaDir = join(sourceRoot, "beta");
    const gammaDir = join(sourceRoot, "gamma");
    mkdirSync(alphaDir, { recursive: true });
    mkdirSync(betaDir, { recursive: true });
    mkdirSync(gammaDir, { recursive: true });
    writeFileSync(
      join(alphaDir, "SKILL.md"),
      [
        "---",
        "name: alpha",
        "description: alpha skill from frontmatter",
        "---",
        "",
        "Alpha body",
      ].join("\n"),
    );
    writeFileSync(
      join(betaDir, "SKILL.md"),
      [
        "---",
        "name: beta",
        "---",
        "",
        "这是 beta 的首段描述。",
      ].join("\n"),
    );
    writeFileSync(
      join(gammaDir, "SKILL.md"),
      [
        "---",
        "name: gamma",
        "---",
      ].join("\n"),
    );

    try {
      const sent: { type: MessageType; payload: string }[] = [];
      const sendEnvelope = async (type: MessageType, plaintext: string) => {
        sent.push({ type, payload: plaintext });
      };

      await handleRpc({
        id: "si1",
        method: "skill_install_prepare",
        params: { source: sourceRoot, scope: "project" },
      }, { sendEnvelope });

      const resp = JSON.parse(sent.pop()!.payload) as {
        error?: string;
        result?: { installId: string; candidates: Array<{ name: string; description: string; warnings?: string[] }> };
      };
      expect(resp.error).toBeUndefined();
      expect(resp.result?.installId).toBeTruthy();
      const items = resp.result?.candidates ?? [];
      expect(items.length).toBe(3);
      const alpha = items.find((item) => item.name === "alpha");
      const beta = items.find((item) => item.name === "beta");
      const gamma = items.find((item) => item.name === "gamma");
      expect(alpha?.description).toContain("frontmatter");
      expect(beta?.description).toContain("首段描述");
      expect(gamma?.description).toBe("(no description)");
      expect(gamma?.warnings?.includes("missing_description")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skill_install_commit 支持选择安装与冲突策略", async () => {
    resetSkillInstallSessionsForTest();
    const root = mkdtempSync(join(tmpdir(), "yuanio-rpc-skill-commit-"));
    const sourceRoot = join(root, "skills-source");
    const alphaDir = join(sourceRoot, "alpha");
    const betaDir = join(sourceRoot, "beta");
    mkdirSync(alphaDir, { recursive: true });
    mkdirSync(betaDir, { recursive: true });
    writeFileSync(
      join(alphaDir, "SKILL.md"),
      [
        "---",
        "name: alpha",
        "description: Alpha desc",
        "---",
        "",
        "Alpha body",
      ].join("\n"),
    );
    writeFileSync(
      join(betaDir, "SKILL.md"),
      [
        "---",
        "name: beta",
        "description: Beta desc",
        "---",
        "",
        "Beta body",
      ].join("\n"),
    );

    const originalCwd = process.cwd();
    process.chdir(root);

    try {
      const sent: { type: MessageType; payload: string }[] = [];
      const sendEnvelope = async (type: MessageType, plaintext: string) => {
        sent.push({ type, payload: plaintext });
      };

      await handleRpc({
        id: "si2-prepare-1",
        method: "skill_install_prepare",
        params: { source: sourceRoot, scope: "project" },
      }, { sendEnvelope });
      const prepare1 = JSON.parse(sent.pop()!.payload) as {
        result?: { installId: string };
      };
      const installId1 = prepare1.result?.installId as string;

      await handleRpc({
        id: "si2-commit-1",
        method: "skill_install_commit",
        params: { installId: installId1, selected: ["alpha"] },
      }, { sendEnvelope });
      const commit1 = JSON.parse(sent.pop()!.payload) as {
        error?: string;
        result?: { installed?: Array<{ name: string; targetPath: string }>; skipped?: unknown[] };
      };
      expect(commit1.error).toBeUndefined();
      expect(commit1.result?.installed?.length).toBe(1);
      expect(commit1.result?.installed?.[0]?.name).toBe("alpha");
      expect(existsSync(join(root, ".agents", "skills", "alpha", "SKILL.md"))).toBe(true);

      await handleRpc({
        id: "si2-prepare-2",
        method: "skill_install_prepare",
        params: { source: sourceRoot, scope: "project" },
      }, { sendEnvelope });
      const prepare2 = JSON.parse(sent.pop()!.payload) as {
        result?: { installId: string };
      };
      const installId2 = prepare2.result?.installId as string;

      await handleRpc({
        id: "si2-commit-2",
        method: "skill_install_commit",
        params: { installId: installId2, selected: ["alpha"], conflictPolicy: "skip" },
      }, { sendEnvelope });
      const commit2 = JSON.parse(sent.pop()!.payload) as {
        error?: string;
        result?: { installed?: unknown[]; skipped?: Array<{ name: string }> };
      };
      expect(commit2.error).toBeUndefined();
      expect(commit2.result?.installed?.length).toBe(0);
      expect(commit2.result?.skipped?.length).toBe(1);
      expect(commit2.result?.skipped?.[0]?.name).toBe("alpha");

      await handleRpc({
        id: "si2-prepare-3",
        method: "skill_install_prepare",
        params: { source: sourceRoot, scope: "project" },
      }, { sendEnvelope });
      const prepare3 = JSON.parse(sent.pop()!.payload) as {
        result?: { installId: string };
      };
      const installId3 = prepare3.result?.installId as string;

      await handleRpc({
        id: "si2-commit-3",
        method: "skill_install_commit",
        params: { installId: installId3, selected: ["alpha"], conflictPolicy: "rename" },
      }, { sendEnvelope });
      const commit3 = JSON.parse(sent.pop()!.payload) as {
        error?: string;
        result?: { installed?: Array<{ targetPath: string }> };
      };
      expect(commit3.error).toBeUndefined();
      expect(commit3.result?.installed?.length).toBe(1);
      const renamedPath = commit3.result?.installed?.[0]?.targetPath || "";
      expect(renamedPath.endsWith("alpha-1") || renamedPath.endsWith("alpha-2")).toBe(true);
      expect(existsSync(join(renamedPath, "SKILL.md"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skill_install_* 返回统一错误码", async () => {
    resetSkillInstallSessionsForTest();
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleRpc({
      id: "si-code-1",
      method: "skill_install_commit",
      params: {},
    }, { sendEnvelope });

    const resp = JSON.parse(sent.pop()!.payload) as { error?: string; errorCode?: string };
    expect(resp.error).toContain("installId is required");
    expect(resp.errorCode).toBe("SKILL_INSTALL_INSTALL_ID_REQUIRED");
  });

  it("shell_exec 支持 dryRun 与安全拦截", async () => {
    const sent: { type: MessageType; payload: string }[] = [];
    const sendEnvelope = async (type: MessageType, plaintext: string) => {
      sent.push({ type, payload: plaintext });
    };

    await handleRpc({
      id: "shell-1",
      method: "shell_exec",
      params: { command: "git push origin main", dryRun: true },
    }, { sendEnvelope });
    const dryRunResp = JSON.parse(sent.pop()!.payload) as {
      error?: string;
      result?: { dryRun: boolean; safety?: { decision: string } };
    };
    expect(dryRunResp.error).toBeUndefined();
    expect(dryRunResp.result?.dryRun).toBe(true);
    expect(dryRunResp.result?.safety?.decision).toBe("prompt");

    await handleRpc({
      id: "shell-2",
      method: "shell_exec",
      params: { command: "git push origin main" },
    }, { sendEnvelope });
    const promptResp = JSON.parse(sent.pop()!.payload) as {
      error?: string;
      result?: { blocked: boolean; requiresConfirmation: boolean };
    };
    expect(promptResp.error).toBeUndefined();
    expect(promptResp.result?.blocked).toBe(true);
    expect(promptResp.result?.requiresConfirmation).toBe(true);

    await handleRpc({
      id: "shell-3",
      method: "shell_exec",
      params: { command: "git reset --hard HEAD~1" },
    }, { sendEnvelope });
    const forbiddenResp = JSON.parse(sent.pop()!.payload) as { error?: string };
    expect(forbiddenResp.error).toContain("shell_exec blocked");
  });
});
