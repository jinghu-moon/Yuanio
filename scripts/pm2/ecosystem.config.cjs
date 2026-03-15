const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const relayPort = process.env.YUANIO_RELAY_PORT || "3000";
const controlServer = process.env.YUANIO_CONTROL_SERVER || `http://localhost:${relayPort}`;
const isWin = process.platform === "win32";

function buildApp(name, commandArgs, env = {}, runner = "bun") {
  if (isWin) {
    return {
      name,
      cwd: root,
      script: "cmd.exe",
      args: `/c ${runner} ${commandArgs}`,
      interpreter: "none",
      env,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1500,
    };
  }
  return {
    name,
    cwd: root,
    script: runner,
    args: commandArgs,
    interpreter: "none",
    env,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1500,
  };
}

module.exports = {
  apps: [
    buildApp("yuanio-relay", "run --manifest-path crates/relay-server/Cargo.toml", {
      PORT: relayPort,
    }, "cargo"),
    buildApp("yuanio-daemon", `run packages/cli/src/daemon-process.ts --server ${controlServer}`),
  ],
};
