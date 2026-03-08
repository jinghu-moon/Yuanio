import { describe, it, expect, beforeEach } from "bun:test";
import { __test__ } from "../local-server";

describe("local-server nonce", () => {
  beforeEach(() => {
    __test__.clearNonces();
  });

  it("重复 nonce 同设备会被拒绝", () => {
    expect(__test__.registerNonce("dev1", "nonce1")).toBe(true);
    expect(__test__.registerNonce("dev1", "nonce1")).toBe(false);
  });

  it("相同 nonce 不同设备允许", () => {
    expect(__test__.registerNonce("dev1", "nonce1")).toBe(true);
    expect(__test__.registerNonce("dev2", "nonce1")).toBe(true);
  });

  it("过期 nonce 可再次使用", () => {
    const realNow = Date.now;
    try {
      let now = 1_000;
      Date.now = () => now;
      expect(__test__.registerNonce("dev1", "nonce1")).toBe(true);
      now += __test__.authWindowMs + 1;
      expect(__test__.registerNonce("dev1", "nonce1")).toBe(true);
      expect(__test__.getNonceCount("dev1")).toBe(1);
    } finally {
      Date.now = realNow;
    }
  });
});
