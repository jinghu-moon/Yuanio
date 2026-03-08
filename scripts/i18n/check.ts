import {
  collectUsedI18nKeys,
  diffKeys,
  makeSet,
  readLocaleMap,
} from "./lib.ts";

const BASE_LOCALE = "en" as const;
const TARGET_LOCALES = ["zh-CN", "zh-TW"] as const;
const UNUSED_IGNORE_PREFIXES = ["status."];

function reportList(header: string, keys: string[]) {
  if (keys.length === 0) return;
  console.error(header);
  for (const key of keys) console.error(`  - ${key}`);
}

function main() {
  const en = readLocaleMap(BASE_LOCALE);
  const enKeySet = makeSet(Object.keys(en));
  const used = collectUsedI18nKeys();

  let hasError = false;

  const missingInEn = diffKeys(used, enKeySet);
  if (missingInEn.length > 0) {
    hasError = true;
    reportList("Missing keys in en.ts (used in code):", missingInEn);
  }

  for (const locale of TARGET_LOCALES) {
    const map = readLocaleMap(locale);
    const keySet = makeSet(Object.keys(map));

    const missing = diffKeys(enKeySet, keySet);
    const extra = diffKeys(keySet, enKeySet);

    if (missing.length > 0) {
      hasError = true;
      reportList(`Missing keys in ${locale}:`, missing);
    }
    if (extra.length > 0) {
      hasError = true;
      reportList(`Extra keys in ${locale}:`, extra);
    }
  }

  const unusedInEn = diffKeys(enKeySet, used).filter(
    (key) => !UNUSED_IGNORE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (unusedInEn.length > 0) {
    console.log(`Warning: ${unusedInEn.length} key(s) in en.ts are currently unused.`);
  }

  if (hasError) {
    console.error("i18n:check failed.");
    process.exit(1);
  }

  console.log("i18n:check passed.");
}

main();
