import { describe, expect, it } from "vitest";
import { planRenames, type RenameItem } from "./batch-rename";

const items: RenameItem[] = [
  { path: "Trips/Day one.md", isFolder: false },
  { path: "Trips/Day two.md", isFolder: false },
  { path: "Trips/Map.excalidraw.md", isFolder: false },
  { path: "Trips/photo.png", isFolder: false },
  { path: "Trips/Day folder", isFolder: true },
];
const none = () => false;
const brief = (plan: ReturnType<typeof planRenames>) => plan.map((p) => [p.to, p.target, p.problem ?? ""]);

describe("planRenames", () => {
  it("finds and replaces in names (not extensions), with or without matching case", () => {
    expect(brief(planRenames(items.slice(0, 2), { kind: "replace", find: "day", replace: "Stop", matchCase: false }, none))).toEqual([
      ["Stop one", "Trips/Stop one.md", ""],
      ["Stop two", "Trips/Stop two.md", ""],
    ]);
    expect(planRenames(items.slice(0, 2), { kind: "replace", find: "day", replace: "Stop", matchCase: true }, none).map((p) => p.to)).toEqual([
      "Day one",
      "Day two",
    ]);
    // Text with special characters is matched as written.
    expect(planRenames([{ path: "a (1).md", isFolder: false }], { kind: "replace", find: "(1)", replace: "v2", matchCase: false }, none)[0].to).toBe("a v2");
  });

  it("adds text before and after, keeping each kind's ending", () => {
    expect(brief(planRenames(items, { kind: "affix", prefix: "2026 ", suffix: "" }, none))).toEqual([
      ["2026 Day one", "Trips/2026 Day one.md", ""],
      ["2026 Day two", "Trips/2026 Day two.md", ""],
      ["2026 Map", "Trips/2026 Map.excalidraw.md", ""],
      ["2026 photo.png", "Trips/2026 photo.png", ""],
      ["2026 Day folder", "Trips/2026 Day folder", ""],
    ]);
  });

  it("numbers them in order, padded to the same width", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ path: `p${i}.md`, isFolder: false }));
    expect(planRenames(many, { kind: "number", base: "Photo", start: 1 }, none).map((p) => p.to)).toEqual([
      "Photo 01", "Photo 02", "Photo 03", "Photo 04", "Photo 05", "Photo 06", "Photo 07", "Photo 08", "Photo 09", "Photo 10",
    ]);
    expect(planRenames(many.slice(0, 2), { kind: "number", base: "", start: 5 }, none).map((p) => p.to)).toEqual(["5", "6"]);
  });

  it("names the problems: not allowed, the same new name, already taken", () => {
    expect(planRenames(items.slice(0, 1), { kind: "affix", prefix: "a/", suffix: "" }, none)[0].problem).toBe('Name can\'t contain "/".');
    expect(planRenames(items.slice(0, 2), { kind: "replace", find: "one", replace: "two", matchCase: false }, none)[0].problem).toBe(
      "Another file would get this name.",
    );
    const taken = (p: string) => p === "Trips/Stop one.md";
    expect(planRenames(items.slice(0, 1), { kind: "replace", find: "Day", replace: "Stop", matchCase: false }, taken)[0].problem).toBe(
      "A file with this name is already there.",
    );
    // Unchanged names are fine.
    expect(planRenames(items.slice(0, 2), { kind: "replace", find: "zzz", replace: "x", matchCase: false }, () => true).every((p) => !p.problem)).toBe(true);
  });
});
