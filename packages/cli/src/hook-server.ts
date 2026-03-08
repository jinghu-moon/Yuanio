import { createServer, type Server } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface HookServer {
  port: number;
  settingsPath: string;
  stop: () => void;
}

export function startHookServer(
  onSessionHook: (sessionId: string, data: any) => void,
): Promise<HookServer> {
  return new Promise((resolve_p, reject) => {
    const server: Server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/hook/session-start") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);

        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          const sessionId = data.session_id || data.sessionId;
          if (sessionId) onSessionHook(sessionId, data);
        } catch {}

        res.writeHead(200).end("ok");
        return;
      }
      res.writeHead(404).end("not found");
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("Failed to get port"));

      const port = addr.port;
      const settingsPath = generateHookSettings(port);

      resolve_p({ port, settingsPath, stop: () => server.close() });
    });

    server.on("error", reject);
  });
}

function generateHookSettings(port: number): string {
  const dir = join(homedir(), ".yuanio", "tmp", "hooks");
  mkdirSync(dir, { recursive: true });

  const filepath = join(dir, `hook-${process.pid}.json`);
  const forwarderScript = resolve(__dirname, "..", "scripts", "hook_forwarder.cjs");

  writeFileSync(filepath, JSON.stringify({
    hooks: {
      SessionStart: [{
        matcher: "*",
        hooks: [{ type: "command", command: `node "${forwarderScript}" ${port}` }],
      }],
    },
  }, null, 2));

  return filepath;
}
