import { describe, expect, it } from "vitest";
import {
  cellAt,
  cellOffset,
  deleteColumn,
  deleteRow,
  emptyTable,
  formatTable,
  insertColumn,
  insertRow,
  looksLikeSpreadsheet,
  moveColumn,
  moveRow,
  parseDelimited,
  parseTable,
  pasteGrid,
  setAlign,
  sortRows,
  splitRow,
  tableFromGrid,
  tableToCsv,
} from "./table-model";

const src = "| Name | Qty |\n|---|--:|\n| apple | 3 |\n| pear | 10 |";

describe("parseTable", () => {
  it("reads cells and alignment", () => {
    expect(parseTable(src)).toEqual({
      rows: [
        ["Name", "Qty"],
        ["apple", "3"],
        ["pear", "10"],
      ],
      align: [null, "right"],
    });
  });

  it("handles escaped pipes, missing outer pipes and ragged rows", () => {
    const t = parseTable("a | b\n:-: | :--\nx \\| y | z | extra\nonly")!;
    expect(t.align).toEqual(["center", "left", null]);
    expect(t.rows).toEqual([
      ["a", "b", ""],
      ["x | y", "z", "extra"],
      ["only", "", ""],
    ]);
  });

  it("rejects text that isn't a table", () => {
    expect(parseTable("| a |\nnot a delimiter")).toBeNull();
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
  });
});

describe("formatTable", () => {
  it("pads columns, honours alignment and escapes pipes", () => {
    const t = parseTable(src)!;
    t.rows[1][0] = "a|b";
    expect(formatTable(t)).toBe(
      ["| Name | Qty |", "| ---- | --: |", "| a\\|b |   3 |", "| pear |  10 |"].join("\n"),
    );
  });

  it("centres and turns line breaks into <br>", () => {
    const t = { rows: [["h"], ["one\ntwo"]], align: ["center" as const] };
    expect(formatTable(t)).toBe("|     h      |\n| :--------: |\n| one<br>two |");
  });

  it("round-trips", () => {
    const once = formatTable(parseTable(src)!);
    expect(formatTable(parseTable(once)!)).toBe(once);
  });

  it("makes empty tables", () => {
    expect(formatTable(emptyTable(1, 2))).toBe("| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |");
  });
});

describe("editing", () => {
  const t = parseTable(src)!;
  it("inserts, deletes and moves rows (never the header)", () => {
    expect(insertRow(t, 2).rows.map((r) => r[0])).toEqual(["Name", "apple", "", "pear"]);
    expect(insertRow(t, 0).rows[0][0]).toBe("Name");
    expect(deleteRow(t, 1).rows.map((r) => r[0])).toEqual(["Name", "pear"]);
    expect(deleteRow(t, 0)).toBe(t);
    expect(moveRow(t, 2, -1).rows.map((r) => r[0])).toEqual(["Name", "pear", "apple"]);
    expect(moveRow(t, 1, -1)).toBe(t);
  });

  it("inserts, deletes and moves columns with their alignment", () => {
    expect(insertColumn(t, 1)).toMatchObject({ rows: [["Name", "", "Qty"], ["apple", "", "3"], ["pear", "", "10"]], align: [null, null, "right"] });
    expect(deleteColumn(t, 0)).toMatchObject({ rows: [["Qty"], ["3"], ["10"]], align: ["right"] });
    expect(deleteColumn(deleteColumn(t, 0), 0).align).toHaveLength(1);
    expect(moveColumn(t, 0, 1)).toMatchObject({ rows: [["Qty", "Name"], ["3", "apple"], ["10", "pear"]], align: ["right", null] });
    expect(setAlign(t, 0, "center").align).toEqual(["center", "right"]);
  });

  it("sorts numbers numerically, text ignoring case, empty cells last", () => {
    const n = parseTable("|a|\n|-|\n|10|\n||\n|9|\n|100|")!;
    expect(sortRows(n, 0, "asc").rows.flat()).toEqual(["a", "9", "10", "100", ""]);
    expect(sortRows(n, 0, "desc").rows.flat()).toEqual(["a", "100", "10", "9", ""]);
    const w = parseTable("|a|\n|-|\n|banana|\n|Apple|")!;
    expect(sortRows(w, 0, "asc").rows.flat()).toEqual(["a", "Apple", "banana"]);
  });

  it("pastes a block of cells, growing the table", () => {
    const p = pasteGrid(t, 2, 1, [["x", "y"], ["z"]]);
    expect(p.rows).toEqual([
      ["Name", "Qty", ""],
      ["apple", "3", ""],
      ["pear", "x", "y"],
      ["", "z", ""],
    ]);
  });
});

describe("delimited text", () => {
  it("parses tabs and quoted CSV", () => {
    expect(parseDelimited("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited('name,note\n"Smith, J","said ""hi"""')).toEqual([["name", "note"], ["Smith, J", 'said "hi"']]);
  });

  it("recognises spreadsheet copies", () => {
    expect(looksLikeSpreadsheet("a\tb\n1\t2")).toBe(true);
    expect(looksLikeSpreadsheet("a\tb")).toBe(false);
    expect(looksLikeSpreadsheet("a\tb\n1")).toBe(false);
    expect(looksLikeSpreadsheet("plain\ntext")).toBe(false);
  });

  it("converts to and from tables", () => {
    const t = tableFromGrid([["a", "b"], ["1"]]);
    expect(t.rows).toEqual([["a", "b"], ["1", ""]]);
    expect(tableToCsv(parseTable('|a|b|\n|-|-|\n|x, y|"q"|')!)).toBe('a,b\n"x, y","""q"""');
  });
});

describe("cell positions", () => {
  const f = formatTable(parseTable(src)!);
  it("finds the cell at an offset", () => {
    expect(cellAt(f, 0)).toEqual({ row: 0, col: 0 });
    expect(cellAt(f, f.indexOf("Qty"))).toEqual({ row: 0, col: 1 });
    expect(cellAt(f, f.indexOf("---"))).toEqual({ row: 0, col: 0 });
    expect(cellAt(f, f.indexOf("pear") + 2)).toEqual({ row: 2, col: 0 });
    expect(cellAt(f, f.length)).toEqual({ row: 2, col: 1 });
  });

  it("finds where a cell's text starts", () => {
    expect(f.slice(cellOffset(f, 0, 1)).startsWith("Qty")).toBe(true);
    expect(f.slice(cellOffset(f, 2, 0)).startsWith("pear")).toBe(true);
    const e = formatTable(emptyTable(1, 2));
    const at = cellOffset(e, 1, 1);
    expect(cellAt(e, at)).toEqual({ row: 1, col: 1 });
  });
});
