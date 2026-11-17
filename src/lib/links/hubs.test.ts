import { describe, expect, it } from "vitest";
import { addToHub, hubsFor, pinnedHubs } from "./hubs";
import { LinkIndex } from "./link-index";

const hub = (body: string) => `---\nhub: true\n---\n${body}`;

describe("hubsFor", () => {
  const ix = new LinkIndex();
  ix.set("Cooking.md", hub("[[Pasta]] [[Bread]]"));
  ix.set("Travel.md", hub("#trips\n[[Italy]]"));
  ix.set("Pasta.md", "[[Cooking]] dinner");
  ix.set("Bread.md", "flour");
  ix.set("Italy.md", "");
  ix.set("Risotto.md", "Like Pasta, see [[Italy]]. Cooking it slowly. #trips");
  ix.set("Lonely.md", "nothing here");

  it("lists pinned hubs", () => {
    expect(pinnedHubs(ix)).toEqual(["Cooking.md", "Travel.md"]);
  });

  it("finds the hubs a note is connected to, in either direction", () => {
    expect(hubsFor(ix, "Pasta.md").connected).toEqual([{ hub: "Cooking.md", direction: "both" }]);
    expect(hubsFor(ix, "Bread.md").connected).toEqual([{ hub: "Cooking.md", direction: "in" }]);
    expect(hubsFor(ix, "Pasta.md").suggestions).toEqual([]);
  });

  it("suggests hubs an unconnected note mentions, shares tags or links with", () => {
    const s = hubsFor(ix, "Risotto.md").suggestions;
    expect(s.map((x) => x.hub)).toEqual(["Cooking.md", "Travel.md"]);
    expect(s[0].reasons).toEqual(["mentions Cooking"]);
    expect(s[1].reasons).toEqual(["#trips", "1 of its notes linked here"]);
    expect(hubsFor(ix, "Lonely.md").suggestions).toEqual([]);
    // A hub isn't suggested for itself.
    expect(hubsFor(ix, "Cooking.md").connected).toEqual([]);
  });
});

describe("addToHub", () => {
  it("fills the Notes section of a map of content", () => {
    const moc = "# Food\n\n## Start here\n\n- \n\n## Notes\n\n- \n\n## Open questions\n\n- \n";
    expect(addToHub(moc, "[[Pasta]]")).toBe("# Food\n\n## Start here\n\n- \n\n## Notes\n\n- [[Pasta]]\n\n## Open questions\n\n- \n");
    const once = addToHub(moc, "[[Pasta]]");
    expect(addToHub(once, "[[Bread]]")).toContain("## Notes\n\n- [[Pasta]]\n- [[Bread]]\n\n## Open");
  });

  it("appends to the end otherwise, continuing a list", () => {
    expect(addToHub("# Hub\n\nIntro.", "[[A]]")).toBe("# Hub\n\nIntro.\n\n- [[A]]\n");
    expect(addToHub("# Hub\n- [[A]]\n\n", "[[B]]")).toBe("# Hub\n- [[A]]\n- [[B]]\n");
    expect(addToHub("", "[[A]]")).toBe("- [[A]]\n");
  });
});
