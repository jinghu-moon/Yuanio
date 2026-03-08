import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type LocaleName = "en" | "zh-CN" | "zh-TW";

const LAUNCHER_ROOT = join(process.cwd(), "packages", "cli", "src", "launcher");
const I18N_ROOT = join(LAUNCHER_ROOT, "i18n");

const LOCALE_FILE: Record<LocaleName, string> = {
  en: join(I18N_ROOT, "en.ts"),
  "zh-CN": join(I18N_ROOT, "zh-CN.ts"),
  "zh-TW": join(I18N_ROOT, "zh-TW.ts"),
};

const EXPORT_NAME: Record<LocaleName, string> = {
  en: "en",
  "zh-CN": "zhCN",
  "zh-TW": "zhTW",
};

export function getLocaleFile(locale: LocaleName): string {
  return LOCALE_FILE[locale];
}

export function readLocaleMap(locale: LocaleName): Record<string, string> {
  const filePath = getLocaleFile(locale);
  const text = readFileSync(filePath, "utf8");
  const exportName = EXPORT_NAME[locale];
  const match = text.match(
    new RegExp(
      `export\\s+const\\s+${exportName}\\s*:\\s*Record<string,\\s*string>\\s*=\\s*({[\\s\\S]*})\\s*;\\s*$`,
    ),
  );

  if (!match) {
    throw new Error(`Cannot parse locale file: ${relative(process.cwd(), filePath)}`);
  }

  const literal = match[1];
  const parsed = Function(`"use strict"; return (${literal});`)() as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Locale file did not parse to object: ${relative(process.cwd(), filePath)}`);
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string") {
      throw new Error(`Locale value must be string: ${k} in ${relative(process.cwd(), filePath)}`);
    }
    out[k] = v;
  }
  return out;
}

export function writeLocaleMap(locale: LocaleName, map: Record<string, string>): void {
  const filePath = getLocaleFile(locale);
  const exportName = EXPORT_NAME[locale];
  const keys = Object.keys(map);
  const lines: string[] = [`export const ${exportName}: Record<string, string> = {`];
  for (const key of keys) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(map[key])},`);
  }
  lines.push("};", "");
  writeFileSync(filePath, lines.join("\n"), "utf8");
}

export function collectUsedI18nKeys(): Set<string> {
  const result = new Set<string>();
  const files = listTsFiles(LAUNCHER_ROOT)
    .filter((file) => !file.includes(`${sep}i18n${sep}`));

  const regex = /\b(?:i18n\.)?t\(\s*["'`]([A-Za-z0-9._-]+)["'`]/g;
  const labelKeyRegex = /\blabelKey\s*:\s*["'`]([A-Za-z0-9._-]+)["'`]/g;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      result.add(match[1]);
    }
    while ((match = labelKeyRegex.exec(text)) !== null) {
      result.add(match[1]);
    }

    if (text.includes("status.${")) {
      result.add("status.stopped");
      result.add("status.starting");
      result.add("status.running");
      result.add("status.error");
    }

    if (text.includes("config.lang.${")) {
      result.add("config.lang.zh-CN");
      result.add("config.lang.zh-TW");
      result.add("config.lang.en");
    }
  }
  return result;
}

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

export function sortedKeys(map: Record<string, string>): string[] {
  return Object.keys(map);
}

export function diffKeys(base: Set<string>, target: Set<string>): string[] {
  const out: string[] = [];
  for (const key of base) {
    if (!target.has(key)) out.push(key);
  }
  return out.sort();
}

export function makeSet(items: string[]): Set<string> {
  return new Set(items);
}
