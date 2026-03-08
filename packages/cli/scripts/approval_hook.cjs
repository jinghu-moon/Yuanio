#!/usr/bin/env node
// Claude Code PreToolUse hook 脚本
// 仅对危险工具（Bash, Write, Edit）请求审批
"use strict";

const DANGEROUS_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"];
const PORT = process.env.YUANIO_APPROVAL_PORT;

if (!PORT) {
  // 审批服务器未启动，放行
  process.exit(0);
}

// 从 stdin 读取 hook 数据
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || "";

    // 仅对危险工具请求审批
    if (!DANGEROUS_TOOLS.includes(toolName)) {
      process.exit(0);
    }

    requestApproval(data);
  } catch {
    // 解析失败，放行
    process.exit(0);
  }
});

function requestApproval(data) {
  const http = require("http");
  const postData = JSON.stringify(data);

  const req = http.request({
    hostname: "127.0.0.1",
    port: Number(PORT),
    path: "/hook/pre-tool-use",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
    timeout: 130000, // 略大于服务端 120s 超时
  }, (res) => {
    let body = "";
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      try {
        const result = JSON.parse(body);
        process.exit(result.exitCode || 0);
      } catch {
        process.exit(0);
      }
    });
  });

  req.on("error", () => {
    // 连接失败，放行
    process.exit(0);
  });

  req.on("timeout", () => {
    req.destroy();
    process.exit(2); // 超时拒绝
  });

  req.write(postData);
  req.end();
}
