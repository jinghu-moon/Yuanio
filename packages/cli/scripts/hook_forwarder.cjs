// Hook 转发器：Claude 执行此脚本，从 stdin 读取事件数据并 POST 到 Yuanio Hook 服务器
const http = require("http");

const port = parseInt(process.argv[2], 10);
if (!port || isNaN(port)) process.exit(1);

const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const body = Buffer.concat(chunks);
  const req = http.request({
    host: "127.0.0.1", port, method: "POST",
    path: "/hook/session-start",
    headers: { "Content-Type": "application/json", "Content-Length": body.length },
  }, (res) => res.resume());
  req.on("error", () => {}); // 静默忽略，不破坏 Claude
  req.end(body);
});
process.stdin.resume();
