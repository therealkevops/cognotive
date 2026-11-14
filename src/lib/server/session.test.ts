// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seal, unseal } from "./session";

const SECRET = "x".repeat(32);

describe("session sealing", () => {
  it("round-trips data", async () => {
    const sealed = await seal({ a: 1, b: "two" }, SECRET);
    expect(await unseal(sealed, SECRET)).toEqual({ a: 1, b: "two" });
  });

  it("produces different ciphertext each time", async () => {
    expect(await seal({ a: 1 }, SECRET)).not.toBe(await seal({ a: 1 }, SECRET));
  });

  it("rejects tampering, the wrong secret, and garbage", async () => {
    const sealed = await seal({ a: 1 }, SECRET);
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(await unseal(flipped, SECRET)).toBeUndefined();
    expect(await unseal(sealed, "y".repeat(32))).toBeUndefined();
    expect(await unseal("not-a-cookie", SECRET)).toBeUndefined();
    expect(await unseal(undefined, SECRET)).toBeUndefined();
  });

  it("refuses short secrets", async () => {
    await expect(seal({}, "short")).rejects.toThrow(/32 characters/);
  });
});
