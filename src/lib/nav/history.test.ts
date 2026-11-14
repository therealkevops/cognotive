import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, goBack, goForward, renameInHistory, visit } from "./history";

const all = () => true;

describe("navigation history", () => {
  it("goes back and forward like a browser", () => {
    let h = visit(EMPTY_HISTORY, "A"); // A → B
    h = visit(h, "B"); // B → C
    const back = goBack(h, "C", all)!;
    expect(back.path).toBe("B");
    const back2 = goBack(back.history, "B", all)!;
    expect(back2.path).toBe("A");
    expect(goBack(back2.history, "A", all)).toBeNull();
    const fwd = goForward(back2.history, "A", all)!;
    expect(fwd.path).toBe("B");
    expect(goForward(fwd.history, "B", all)!.path).toBe("C");
  });

  it("clears Forward when you go somewhere new", () => {
    const h = visit(visit(EMPTY_HISTORY, "A"), "B");
    const back = goBack(h, "C", all)!; // at B, Forward has C
    const next = visit(back.history, "B"); // B → D
    expect(next.forward).toEqual([]);
    expect(goBack(next, "D", all)!.path).toBe("B");
  });

  it("skips files that no longer exist and the note you're on", () => {
    const h = { back: ["A", "Gone", "C"], forward: [] };
    expect(goBack(h, "C", (p) => p !== "Gone")!.path).toBe("A");
  });

  it("doesn't repeat the same note twice in a row", () => {
    expect(visit(visit(EMPTY_HISTORY, "A"), "A").back).toEqual(["A"]);
  });

  it("follows renames", () => {
    expect(renameInHistory({ back: ["A", "B"], forward: ["A"] }, "A", "Z")).toEqual({ back: ["Z", "B"], forward: ["Z"] });
  });
});
