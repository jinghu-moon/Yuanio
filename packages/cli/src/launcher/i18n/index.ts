import { en } from "./en.ts";
import { zhCN } from "./zh-CN.ts";
import { zhTW } from "./zh-TW.ts";

export type LauncherLocale = "zh-CN" | "zh-TW" | "en";

type MessageParams = Record<string, string | number | boolean | null | undefined>;

export interface LauncherI18n {
  locale: LauncherLocale;
  t: (key: string, params?: MessageParams) => string;
  statusLabel: (status: string) => string;
}

const BUNDLES: Record<LauncherLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

function resolveLocale(raw: string | null | undefined): LauncherLocale | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace("_", "-");

  if (normalized === "zh-cn" || normalized.startsWith("zh-cn") || normalized.includes("hans")) return "zh-CN";
  if (
    normalized === "zh-tw" ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo") ||
    normalized.includes("hant")
  ) {
    return "zh-TW";
  }
  if (normalized === "en" || normalized.startsWith("en-")) return "en";

  return null;
}

export function detectLocaleFromEnv(): LauncherLocale {
  const candidates = [
    process.env.YUANIO_LANG,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().locale;
      } catch {
        return null;
      }
    })(),
  ];

  for (const item of candidates) {
    const locale = resolveLocale(item);
    if (locale) return locale;
  }

  return "en";
}

export function normalizeLocale(input: string | null | undefined, fallback: LauncherLocale = "en"): LauncherLocale {
  return resolveLocale(input) ?? fallback;
}

function format(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export function createI18n(input: string | null | undefined): LauncherI18n {
  const locale = normalizeLocale(input, detectLocaleFromEnv());
  const primary = BUNDLES[locale];
  const fallback = BUNDLES.en;

  const t = (key: string, params?: MessageParams): string => {
    const template = primary[key] ?? fallback[key] ?? key;
    return format(template, params);
  };

  const statusLabel = (status: string): string => t(`status.${status}`);

  return { locale, t, statusLabel };
}
