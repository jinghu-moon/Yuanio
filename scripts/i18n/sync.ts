import { relative } from "node:path";
import {
  collectUsedI18nKeys,
  diffKeys,
  getLocaleFile,
  makeSet,
  readLocaleMap,
  sortedKeys,
  writeLocaleMap,
} from "./lib.ts";

const BASE_LOCALE = "en" as const;
const TARGET_LOCALES = ["zh-CN", "zh-TW"] as const;

function main() {
  const enMap = readLocaleMap(BASE_LOCALE);
  const enKeys = sortedKeys(enMap);
  const enKeySet = makeSet(enKeys);

  const usedKeys = collectUsedI18nKeys();
  const missingInEn = diffKeys(usedKeys, enKeySet);
  if (missingInEn.length > 0) {
    console.error("i18n:sync failed. Add these keys into en.ts first:");
    for (const key of missingInEn) console.error(`  - ${key}`);
    process.exit(1);
  }

  for (const locale of TARGET_LOCALES) {
    const oldMap = readLocaleMap(locale);
    const nextMap: Record<string, string> = {};
    let filled = 0;

    for (const key of enKeys) {
      if (Object.prototype.hasOwnProperty.call(oldMap, key)) {
        nextMap[key] = oldMap[key];
      } else {
        nextMap[key] = enMap[key];
        filled += 1;
      }
    }

    const oldKeys = makeSet(Object.keys(oldMap));
    const extra = diffKeys(oldKeys, enKeySet);

    writeLocaleMap(locale, nextMap);
    console.log(
      [
        `synced ${locale}`,
        `filled=${filled}`,
        `pruned=${extra.length}`,
        `file=${relative(process.cwd(), getLocaleFile(locale))}`,
      ].join(" | "),
    );
  }
}

main();
