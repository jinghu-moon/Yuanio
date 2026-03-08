import type { LauncherLocale } from "./i18n/index.ts";

const ALL_LANGUAGE_OPTIONS: LauncherLocale[] = ["zh-CN", "zh-TW", "en"];

/**
 * 解析平台安全语言。
 * Windows 下只要控制台已切换到 UTF-8 (cp65001)，即可安全显示 CJK 字符，
 * 因此不再无条件回退英文；UTF-8 可用性由调用方 (resolveLauncherLanguage) 守卫。
 */
export function resolvePlatformSafeLanguage(
  preferredLanguage: LauncherLocale,
  _platform: NodeJS.Platform = process.platform,
): LauncherLocale {
  return preferredLanguage;
}

export function getLauncherLanguageOptions(
  _platform: NodeJS.Platform = process.platform,
): LauncherLocale[] {
  return ALL_LANGUAGE_OPTIONS;
}
