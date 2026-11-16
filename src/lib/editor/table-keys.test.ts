import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { Command } from "./formatting";
import { formatTableAtCursor, linesToTable, nextCell, nextRow, previousCell, tableAt, tableToLines } from "./table-keys";

/** Runs a command where "‸" marks the cursor; returns the doc with "‸" at the new cursor (or null if it didn't apply). */
function run(cmd: Command, doc: string, select?: [number, number]): string | null {
  const at = doc.indexOf("‸");
  const text = doc.replace("‸", "");
  let state = EditorState.create({
    doc: text,
    selection: select ? EditorSelection.range(...select) : EditorSelection.cursor(at),
    extensions: markdown({ base: markdownLanguage }),
  });
  const ok = cmd({ state, dispatch: (tr) => (state = tr.state) });
  if (!ok) return null;
  const head = state.selection.main.head;
  const out = state.doc.toString();
  return out.slice(0, head) + "‸" + out.slice(head);
}

const table = "| a | b |\n|---|---|\n| 1 | 2 |";

describe("table keys", () => {
  it("finds the table around the cursor", () => {
    const s = EditorState.create({ doc: "x\n\n" + table + "\n\ny", extensions: markdown({ base: markdownLanguage }) });
    expect(tableAt(s, 5)).toEqual({ from: 3, to: 3 + table.length });
    expect(tableAt(s, 0)).toBeNull();
  });

  it("Tab tidies the table and moves to the next cell, adding a row at the end", () => {
    expect(run(nextCell, "| a‸ | b |\n|---|---|\n| 1 | 2 |")).toBe("| a   | ‸b   |\n| --- | --- |\n| 1   | 2   |");
    expect(run(nextCell, "| a | b |\n|---|---|\n| 1 | 2‸ |")).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |");
    expect(run(previousCell, "| a | b |\n|---|---|\n| 1 | ‸2 |")).toBe("| a   | b   |\n| --- | --- |\n| ‸1   | 2   |");
    expect(run(nextCell, "not a table‸")).toBeNull();
  });

  it("Enter goes down a row, and leaves the table from an empty last row", () => {
    expect(run(nextRow, "| a‸ | b |\n|---|---|\n| 1 | 2 |")).toBe("| a   | b   |\n| --- | --- |\n| ‸1   | 2   |");
    expect(run(nextRow, "| a | b |\n|---|---|\n| 1‸ | 2 |")).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| ‸    |     |");
    expect(run(nextRow, "| a | b |\n|---|---|\n| 1 | 2 |\n|  ‸ |  |")).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n‸");
    // At the very start of the table Enter is an ordinary new line.
    expect(run(nextRow, "‸" + table)).toBeNull();
  });

  it("formats, and converts between tables and CSV lines", () => {
    expect(run(formatTableAtCursor, "|a|‸bb|\n|-|:-:|\n|1|2|")).toBe("| a   | ‸bb  |\n| --- | :-: |\n| 1   |  2  |");
    expect(run(linesToTable, "name,qty\npear,3", [0, 13])).toBe("| ‸name | qty |\n| ---- | --- |\n| pear | 3   |");
    expect(run(tableToLines, "| a | b |\n|---|---|\n| ‸1 | 2 |")?.replace("‸", "")).toBe("a,b\n1,2");
  });
});
