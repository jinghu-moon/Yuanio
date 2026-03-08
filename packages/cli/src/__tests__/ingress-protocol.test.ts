import { describe, expect, it } from "bun:test";
import {
  isPublicIngressNetworkMode,
  normalizeIngressNetworkMode,
  parseSlashCommand,
  resolveMobilePromptSource,
  resolveIngressNetworkMode,
} from "@yuanio/shared";

describe("ingress-protocol", () => {
  it("解析 slash 命令并去掉 mention", () => {
    const parsed = parseSlashCommand("/status@my_bot now", {
      prefix: "/",
      mentionSeparator: "@",
      normalizeCommand: (value) => value.toLowerCase(),
    });
    expect(parsed).toEqual({
      command: "status",
      args: ["now"],
    });
  });

  it("非命令文本返回 null", () => {
    expect(parseSlashCommand("hello")).toBeNull();
  });

  it("归一化网络模式", () => {
    expect(normalizeIngressNetworkMode("lan")).toBe("lan");
    expect(normalizeIngressNetworkMode("cloudflare-tunnel")).toBe("cloudflare");
    expect(normalizeIngressNetworkMode("public")).toBe("public");
    expect(normalizeIngressNetworkMode("auto")).toBe("unknown");
  });

  it("按优先级解析网络模式", () => {
    expect(resolveIngressNetworkMode(undefined, "auto", "cloudflare")).toBe("cloudflare");
    expect(resolveIngressNetworkMode(undefined, null, "lan")).toBe("lan");
  });

  it("识别公网可达模式", () => {
    expect(isPublicIngressNetworkMode("lan")).toBe(false);
    expect(isPublicIngressNetworkMode("public")).toBe(true);
    expect(isPublicIngressNetworkMode("cloudflare")).toBe(true);
  });

  it("归一化移动端入口来源", () => {
    expect(resolveMobilePromptSource({
      transportHint: "local",
      networkMode: "cloudflare",
    })).toBe("mobile_lan");
    expect(resolveMobilePromptSource({
      transportHint: "relay",
      networkMode: "cloudflare",
    })).toBe("mobile_cloudflare");
    expect(resolveMobilePromptSource({
      transportHint: "relay",
      networkMode: "public",
    })).toBe("mobile_public");
    expect(resolveMobilePromptSource({
      transportHint: "relay",
      networkMode: "auto",
    })).toBe("relay");
  });
});
