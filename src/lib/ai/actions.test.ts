import { describe, expect, it } from "vitest";
import { LinkIndex } from "../links/link-index";
import { actionPrompt, type ActionContext } from "./actions";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 18);
const ctx: ActionContext = {
  links: new LinkIndex(),
  today: "2026-11-18",
  now,
  notes: () => [
    { path: "Old.md", mtime: now - 30 * DAY },
    { path: "Plan.md", mtime: now - DAY },
    { path: "Today.md", mtime: now },
  ],
};

describe("actionPrompt", () => {
  it("summarises with the note attached and a summary property proposed", () => {
    const p = actionPrompt({ kind: "summarise", path: "Projects/Plan.md" }, ctx);
    expect(p).toMatchObject({ label: "Summarise Plan", note: "Projects/Plan.md" });
    expect(p.prompt).toContain("`summary` property");
  });

  it("writes a hub under the name the links use", () => {
    const p = actionPrompt({ kind: "write-hub", target: "Gardening", sources: ["A.md", "B.md", "C.md"] }, ctx);
    expect(p.label).toBe("Write the hub Gardening");
    expect(p.prompt).toContain('3 notes link to "Gardening"');
    expect(p.prompt).toContain("- B.md");
    expect(p.prompt).toContain("hub: true");
  });

  it("caps long lists", () => {
    const paths = Array.from({ length: 30 }, (_, i) => `N${i}.md`);
    const p = actionPrompt({ kind: "fix-orphans", paths }, ctx);
    expect(p.label).toBe("Find homes for 30 orphan notes");
    expect(p.prompt).toContain("…and 5 more");
    expect(p.prompt).not.toContain("N29.md");
  });

  it("reviews stale hubs with dates and marks them reviewed", () => {
    const p = actionPrompt({ kind: "review-stale", paths: ["Old.md"] }, ctx);
    expect(p.prompt).toContain("- Old.md (last changed 2026-10-19)");
    expect(p.prompt).toContain("reviewed: 2026-11-18");
  });

  it("fills a property from the values in use", () => {
    expect(actionPrompt({ kind: "fill-property", key: "status", paths: ["A.md"] }, ctx).prompt).toContain('key "status"');
  });

  it("reviews the week from recently changed notes", () => {
    const p = actionPrompt({ kind: "daily-review" }, ctx);
    expect(p.label).toBe("What did I work on this week?");
    expect(p.prompt).toContain("- Today.md (2026-11-18)\n- Plan.md (2026-11-17)");
    expect(p.prompt).not.toContain("Old.md");
    expect(actionPrompt({ kind: "daily-review" }, { ...ctx, notes: () => [] }).prompt).toContain("No notes changed");
  });
});
