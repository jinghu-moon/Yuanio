import { describe, expect, it } from "bun:test";
import { createUniqueRenderKeys } from "../render-keys";

describe("createUniqueRenderKeys", () => {
  it("会为重复基础 key 追加稳定后缀", () => {
    const keys = createUniqueRenderKeys(
      [{ id: "dup" }, { id: "dup" }, { id: "dup" }],
      (item) => item.id,
      "skill",
    );

    expect(keys).toEqual([
      "skill:dup",
      "skill:dup#1",
      "skill:dup#2",
    ]);
  });

  it("会为缺失基础 key 的项提供可预测兜底值", () => {
    const keys = createUniqueRenderKeys(
      [{ id: "" }, { id: undefined }, { id: null }, { id: "  " }],
      (item) => item.id,
      "log",
    );

    expect(keys).toEqual([
      "log:item-0",
      "log:item-1",
      "log:item-2",
      "log:item-3",
    ]);
  });
});
