import { describe, expect, it } from "vitest";
import { activityWeeks, healthScore, scoreVerdict, vaultHealth } from "./health";
import { LinkIndex } from "./link-index";

describe("vaultHealth", () => {
  const ix = new LinkIndex();
  ix.set("Hub.md", "Start here: [[A]]");
  ix.set("A.md", "[[Hub]] and [[Missing]]");
  ix.set("B.md", "[[Hub]] [[missing]]");
  ix.set("C.md", "[[Hub]]");
  ix.set("Lonely.md", "no links");
  ix.set("Daily/2026-11-01.md", "nothing");
  const day = 86_400_000;
  const now = 1000 * day;
  const h = vaultHealth(ix, {
    now,
    mtime: (p) => (p === "Hub.md" ? now - 400 * day : now - day),
    ignore: (p) => p.startsWith("Daily/"),
  });

  it("lists orphans, dead ends and broken links", () => {
    expect(h.orphans).toEqual(["B.md", "C.md", "Lonely.md"]);
    expect(h.deadEnds).toEqual(["Lonely.md"]);
    expect(h.broken).toEqual([{ target: "Missing", sources: ["A.md", "B.md"] }]);
  });

  it("ranks hubs and flags well-linked notes left alone for a long time", () => {
    expect(h.hubs).toEqual([{ path: "Hub.md", links: 3 }]);
    expect(h.stale.map((s) => s.path)).toEqual(["Hub.md"]);
  });

  it("counts notes, links and connected notes, and scores them", () => {
    // Hub↔A, B→Hub, C→Hub: 4 links; Lonely isn't connected.
    expect(h.stats).toEqual({ notes: 5, links: 4, connected: 4, brokenRefs: 2 });
    expect(h.score).toBe(healthScore({ notes: 5, brokenRefs: 2, orphans: 3, deadEnds: 1, stale: 1 }));
  });
});

describe("healthScore", () => {
  it("is 100 for a tidy or empty repository and falls with problems", () => {
    expect(healthScore({ notes: 0, brokenRefs: 0, orphans: 0, deadEnds: 0, stale: 0 })).toBe(100);
    expect(healthScore({ notes: 10, brokenRefs: 0, orphans: 0, deadEnds: 0, stale: 0 })).toBe(100);
    expect(healthScore({ notes: 10, brokenRefs: 1, orphans: 0, deadEnds: 0, stale: 0 })).toBe(97);
    expect(healthScore({ notes: 10, brokenRefs: 50, orphans: 10, deadEnds: 10, stale: 10 })).toBe(0);
    expect(scoreVerdict(90).tone).toBe("good");
    expect(scoreVerdict(10).label).toBe("Mostly scattered");
  });
});

describe("activityWeeks", () => {
  it("buckets change times into days of whole weeks", () => {
    const now = new Date(2026, 10, 18, 12).getTime(); // a Wednesday
    const weeks = activityWeeks([now, now - 3600_000, new Date(2026, 10, 16, 9).getTime()], { now, weeks: 2 });
    expect(weeks).toHaveLength(2);
    expect(weeks[1].map((d) => d?.count ?? null)).toEqual([0, 1, 0, 2, null, null, null]);
    expect(new Date(weeks[0][0]!.day).getDay()).toBe(0);
  });
});
