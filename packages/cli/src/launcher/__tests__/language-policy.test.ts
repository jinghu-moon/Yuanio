import { describe, expect, it } from "bun:test";
import { getLauncherLanguageOptions, resolvePlatformSafeLanguage } from "../language-policy";

describe("resolvePlatformSafeLanguage", () => {
  it("所有平台保留用户首选语言", () => {
    expect(resolvePlatformSafeLanguage("zh-CN", "win32")).toBe("zh-CN");
    expect(resolvePlatformSafeLanguage("zh-TW", "win32")).toBe("zh-TW");
    expect(resolvePlatformSafeLanguage("en", "win32")).toBe("en");
    expect(resolvePlatformSafeLanguage("zh-CN", "linux")).toBe("zh-CN");
    expect(resolvePlatformSafeLanguage("zh-TW", "darwin")).toBe("zh-TW");
  });
});

describe("getLauncherLanguageOptions", () => {
  it("所有平台暴露全部语言选项", () => {
    expect(getLauncherLanguageOptions("win32")).toEqual(["zh-CN", "zh-TW", "en"]);
    expect(getLauncherLanguageOptions("linux")).toEqual(["zh-CN", "zh-TW", "en"]);
  });
});
