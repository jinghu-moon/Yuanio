import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface ApprovalRequest {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  resolve: (approved: boolean) => void;
}

const APPROVAL_TIMEOUT = 120_000; // 120s
const pending = new Map<string, ApprovalRequest>();
let server: ReturnType<typeof createServer> | null = null;
let serverPort = 0;

export type OnApprovalRequest = (req: ApprovalRequest) => void;

/** 外部调用：审批结果到达时 resolve 对应的 pending Promise */
export function resolveApproval(id: string, approved: boolean) {
  const req = pending.get(id);
  if (req) {
    req.resolve(approved);
    pending.delete(id);
  }
}

export function getApprovalPort(): number {
  return serverPort;
}

/** 启动本地审批 HTTP 服务器 */
export function startApprovalServer(onRequest: OnApprovalRequest): Promise<number> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/hook/pre-tool-use") {
        handleHookRequest(req, res, onRequest);
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
        console.log(`[approval] 审批服务器启动: http://127.0.0.1:${serverPort}`);
        resolve(serverPort);
      } else {
        reject(new Error("无法获取端口"));
      }
    });

    server.on("error", reject);
  });
}

function handleHookRequest(req: IncomingMessage, res: ServerResponse, onRequest: OnApprovalRequest) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      const id = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const approvalPromise = new Promise<boolean>((resolve) => {
        const req: ApprovalRequest = {
          id,
          tool: data.tool_name || data.tool || "unknown",
          input: data.tool_input || data.input || {},
          resolve,
        };
        pending.set(id, req);
        onRequest(req);

        // 超时自动拒绝
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            resolve(false);
          }
        }, APPROVAL_TIMEOUT);
      });

      approvalPromise.then((approved) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ exitCode: approved ? 0 : 2 }));
      });
    } catch {
      res.writeHead(400);
      res.end("invalid json");
    }
  });
}

export function stopApprovalServer() {
  if (server) {
    server.close();
    server = null;
  }
  pending.clear();
}
