import { join } from "node:path";

/**
 * 项目各包的根目录锚点，供 Bun.spawn 等需要真实路径的场景使用。
 * 基于 cli 包的 package.json 位置向上推导，不依赖相对路径层级。
 */
const CLI_ROOT = join(import.meta.dir, "..");
const PACKAGES_ROOT = join(CLI_ROOT, "..");
const REPO_ROOT = join(PACKAGES_ROOT, "..");

export const paths = {
  repoRoot: REPO_ROOT,
  cliRoot: CLI_ROOT,
  cliSrc: join(CLI_ROOT, "src"),
  relayRoot: join(PACKAGES_ROOT, "relay-server"),
  relaySrc: join(PACKAGES_ROOT, "relay-server", "src"),

  /** 解析 cli/src 下的文件路径 */
  cli: (file: string) => join(CLI_ROOT, "src", file),

  /** 解析 relay-server/src 下的文件路径 */
  relay: (file: string) => join(PACKAGES_ROOT, "relay-server", "src", file),

  /** 解析仓库根目录 scripts 下的脚本路径 */
  script: (file: string) => join(REPO_ROOT, "scripts", file),
} as const;
