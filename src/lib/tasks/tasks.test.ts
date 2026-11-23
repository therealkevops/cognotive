import { describe, expect, it } from "vitest";
import { compareTasks, dueGroup, filterTasks, parseTasks, toggleTask } from "./tasks";

const note = [
  "---",
  "tags: [x]",
  "- [ ] not a task: frontmatter",
  "---",
  "# Plan",
  "",
  "- [ ] Buy seeds 📅 2026-11-22 ⏫ #garden",
  "  - [x] Measure beds ✅ 2026-11-18",
  "* [ ] Call [[Ann]] [due:: 2026-11-19]",
  "## Later",
  "1. [/] Draft the post ⏳ 2026-12-01 🔽",
  "- [-] Old idea",
  "```",
  "- [ ] in a code block",
  "```",
  "- [ ] Water plants 🔁 every week 📅 2026-11-20",
  "- [] not a task",
].join("\n");

describe("parseTasks", () => {
  const tasks = parseTasks("Plan.md", note);
  it("finds tasks outside frontmatter and code, with headings and nesting", () => {
    expect(tasks.map((t) => t.text)).toEqual(["Buy seeds #garden", "Measure beds", "Call [[Ann]]", "Draft the post", "Old idea", "Water plants"]);
    expect(tasks.map((t) => t.heading)).toEqual(["Plan", "Plan", "Plan", "Later", "Later", "Later"]);
    expect(tasks[1].depth).toBe(1);
    expect(tasks[0].line).toBe(6);
    expect(note.slice(tasks[0].offset, tasks[0].offset + 5)).toBe("- [ ]");
  });
  it("reads dates, priorities, status and tags", () => {
    expect(tasks[0]).toMatchObject({ due: "2026-11-22", priority: "high", tags: ["garden"], done: false });
    expect(tasks[1]).toMatchObject({ done: true, completed: "2026-11-18" });
    expect(tasks[2].due).toBe("2026-11-19");
    expect(tasks[3]).toMatchObject({ mark: "/", done: false, scheduled: "2026-12-01", priority: "low" });
    expect(tasks[4]).toMatchObject({ done: true, cancelled: true });
    expect(tasks[5].due).toBe("2026-11-20");
  });
  it("reads a priority written as a field, as the / menu writes it", () => {
    const [t] = parseTasks("a.md", "- [ ] Call Sam [priority:: high] [due:: 2026-11-24]");
    expect(t).toMatchObject({ text: "Call Sam", priority: "high", due: "2026-11-24" });
  });
});

describe("toggleTask", () => {
  const [buy, measure, call] = parseTasks("Plan.md", note);
  it("ticks and clears the box, writing no emoji", () => {
    const done = toggleTask(note, buy, true)!;
    expect(done.split("\n")[6]).toBe("- [x] Buy seeds 📅 2026-11-22 ⏫ #garden");
    expect(toggleTask(done, parseTasks("Plan.md", done)[0], false)).toBe(note);
    // Clearing a done task drops the done date it no longer has.
    expect(toggleTask(note, measure, false)!.split("\n")[7]).toBe("  - [ ] Measure beds");
    expect(toggleTask(note, call, true)!.split("\n")[8]).toBe("* [x] Call [[Ann]] [due:: 2026-11-19]");
  });
  it("refuses when the line changed since", () => {
    expect(toggleTask(note.replace("Buy seeds", "Buy bulbs"), buy, true)).toBeNull();
  });
});

describe("grouping and filtering", () => {
  const tasks = parseTasks("Plan.md", note);
  it("groups by due date", () => {
    expect(tasks.map((t) => dueGroup(t, "2026-11-20"))).toEqual(["week", "none", "overdue", "later", "none", "today"]);
    expect(dueGroup({ due: "2026-11-21" }, "2026-11-20")).toBe("tomorrow");
  });
  it("sorts by date, then priority", () => {
    const a = { ...tasks[0], due: "2026-11-22", priority: "low" as const };
    const b = { ...tasks[0], due: "2026-11-22", priority: "high" as const };
    expect([a, b, tasks[2]].sort(compareTasks)).toEqual([tasks[2], b, a]);
  });
  it("filters by status, words, tags and date", () => {
    expect(filterTasks(tasks, {}).map((t) => t.text)).toEqual(["Buy seeds #garden", "Call [[Ann]]", "Draft the post", "Water plants"]);
    expect(filterTasks(tasks, { status: "done" })).toHaveLength(2);
    expect(filterTasks(tasks, { text: "#garden" })).toHaveLength(1);
    expect(filterTasks(tasks, { dueBefore: "2026-11-20" }).map((t) => t.text)).toEqual(["Call [[Ann]]", "Water plants"]);
  });
});
