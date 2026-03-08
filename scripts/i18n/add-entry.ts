import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readLocaleMap, writeLocaleMap } from "./lib.ts";

interface Args {
  key: string | null;
  en: string | null;
  zhCN: string | null;
  zhTW: string | null;
  overwrite: boolean;
  interactive: boolean;
  runCheck: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (...names: string[]): string | null => {
    for (const name of names) {
      const idx = argv.indexOf(name);
      if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
    }
    return null;
  };

  const has = (...names: string[]): boolean => names.some((name) => argv.includes(name));

  return {
    key: get("--key") ?? process.env.I18N_KEY ?? null,
    en: get("--en") ?? process.env.I18N_EN ?? null,
    zhCN: get("--zh-cn", "--zh-CN") ?? process.env.I18N_ZH_CN ?? null,
    zhTW: get("--zh-tw", "--zh-TW") ?? process.env.I18N_ZH_TW ?? null,
    overwrite: has("--overwrite") || process.env.I18N_OVERWRITE === "1",
    interactive: has("--interactive") || process.env.I18N_INTERACTIVE === "1",
    runCheck: has("--check", "--run-check") || process.env.I18N_RUN_CHECK === "1",
  };
}

function validateKey(args: { key: string }) {
  if (!/^[A-Za-z0-9._-]+$/.test(args.key)) {
    console.error(`Invalid key "${args.key}". Allowed: A-Z a-z 0-9 . _ -`);
    process.exit(1);
  }
}

async function promptRequired(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  value: string | null,
): Promise<string> {
  if (value && value.trim().length > 0) return value.trim();

  while (true) {
    const answer = (await rl.question(`${prompt}: `)).trim();
    if (answer.length > 0) return answer;
  }
}

async function confirm(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<boolean> {
  const answer = (await rl.question(`${prompt} [y/N]: `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function resolveInput(raw: Args): Promise<Required<Args>> {
  const canPrompt = !!stdin.isTTY && !!stdout.isTTY;
  const needPrompt = !raw.key || !raw.en || !raw.zhCN || !raw.zhTW || raw.interactive;

  if (!needPrompt) {
    return {
      key: raw.key!,
      en: raw.en!,
      zhCN: raw.zhCN!,
      zhTW: raw.zhTW!,
      overwrite: raw.overwrite,
      interactive: raw.interactive,
      runCheck: raw.runCheck,
    };
  }

  if (!canPrompt) {
    console.error(
      [
        "Missing required input and not in interactive TTY.",
        "Provide by args or env:",
        "--key --en --zh-cn --zh-tw",
      ].join("\n"),
    );
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const key = await promptRequired(rl, "i18n key (example: demo.love_you)", raw.key);
    const en = await promptRequired(rl, "English text", raw.en);
    const zhCN = await promptRequired(rl, "Simplified Chinese text (zh-CN)", raw.zhCN);
    const zhTW = await promptRequired(rl, "Traditional Chinese text (zh-TW)", raw.zhTW);
    return {
      key,
      en,
      zhCN,
      zhTW,
      overwrite: raw.overwrite,
      interactive: raw.interactive,
      runCheck: raw.runCheck,
    };
  } finally {
    rl.close();
  }
}

function runCheck() {
  const result = spawnSync(
    process.execPath,
    ["run", "scripts/i18n/check.ts"],
    { stdio: "inherit", cwd: process.cwd() },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const args = await resolveInput(parseArgs(process.argv.slice(2)));
  validateKey(args);

  const enMap = readLocaleMap("en");
  const zhCNMap = readLocaleMap("zh-CN");
  const zhTWMap = readLocaleMap("zh-TW");

  const exists = Object.prototype.hasOwnProperty.call(enMap, args.key);
  if (exists && !args.overwrite) {
    if (stdin.isTTY && stdout.isTTY) {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        const ok = await confirm(rl, `Key already exists: ${args.key}. Overwrite`);
        if (!ok) {
          console.error("Cancelled.");
          process.exit(1);
        }
      } finally {
        rl.close();
      }
    } else {
      console.error(`Key already exists: ${args.key}`);
      console.error("Use --overwrite to replace.");
      process.exit(1);
    }
  }

  enMap[args.key] = args.en;
  zhCNMap[args.key] = args.zhCN;
  zhTWMap[args.key] = args.zhTW;

  writeLocaleMap("en", enMap);
  writeLocaleMap("zh-CN", zhCNMap);
  writeLocaleMap("zh-TW", zhTWMap);

  console.log(
    [
      `updated key: ${args.key}`,
      `overwrite: ${args.overwrite ? "yes" : "no"}`,
      "files: en.ts, zh-CN.ts, zh-TW.ts",
    ].join("\n"),
  );

  if (args.runCheck) {
    runCheck();
  }
}

void main();
