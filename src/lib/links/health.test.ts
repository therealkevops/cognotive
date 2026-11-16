import { describe, expect, it } from "vitest";
import { vaultHealth } from "./health";
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
});
