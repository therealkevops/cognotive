import { describe, expect, it } from "vitest";
import { linkBoost } from "./rank";

describe("linkBoost", () => {
  it("favours recently opened notes, then well-linked ones", () => {
    expect(linkBoost({})).toBe(0);
    expect(linkBoost({ recentRank: 0 })).toBe(30);
    expect(linkBoost({ recentRank: 1 })).toBeGreaterThan(linkBoost({ recentRank: 5 }));
    expect(linkBoost({ recentRank: 20 })).toBe(0);
    expect(linkBoost({ inbound: 3 })).toBe(10);
    expect(linkBoost({ inbound: 1000 })).toBe(15);
    expect(linkBoost({ recentRank: 0 })).toBeGreaterThan(linkBoost({ inbound: 1000 }));
  });
});
