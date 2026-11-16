/**
 * Markdown (GFM) tables as data: parse, edit and write back. A table is a list
 * of rows (row 0 is the header), every row with the same number of cells, and
 * an alignment per column. Cell text is kept unescaped ("a|b", not "a\|b");
 * `formatTable` escapes pipes again and pads the columns so the source lines up.
 */

export type Align = "left" | "center" | "right" | null;

export interface Table {
  rows: string[][];
  align: Align[];
}

const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

/** Splits a table line into cells on unescaped pipes, dropping the outer pipes. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function parseAlign(cell: string): Align {
  const c = cell.trim();
  const l = c.startsWith(":");
  const r = c.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

export function isDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

/** Parses a markdown table (header line, delimiter line, body lines); null if it isn't one. */
export function parseTable(text: string): Table | null {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const align = splitRow(lines[1]).map(parseAlign);
  const body = lines.slice(2).map(splitRow);
  const width = Math.max(header.length, align.length, ...body.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill("")];
  return {
    rows: [pad(header), ...body.map(pad)],
    align: [...align, ...Array<Align>(width - align.length).fill(null)].slice(0, width),
  };
}

const escapeCell = (s: string) => s.replace(/\r?\n/g, "<br>").replace(/\\?\|/g, "\\|").trim();
/** Display width: characters, not UTF-16 units. */
const width = (s: string) => [...s].length;

function pad(s: string, w: number, align: Align): string {
  const extra = w - width(s);
  if (extra <= 0) return s;
  if (align === "right") return " ".repeat(extra) + s;
  if (align === "center") {
    const left = Math.floor(extra / 2);
    return " ".repeat(left) + s + " ".repeat(extra - left);
  }
  return s + " ".repeat(extra);
}

function delimiter(w: number, align: Align): string {
  if (align === "center") return ":" + "-".repeat(w - 2) + ":";
  if (align === "right") return "-".repeat(w - 1) + ":";
  if (align === "left") return ":" + "-".repeat(w - 1);
  return "-".repeat(w);
}

/** Writes a table as markdown with aligned columns. */
export function formatTable(t: Table): string {
  const cells = t.rows.map((r) => r.map(escapeCell));
  const cols = t.align.length;
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...cells.map((r) => width(r[c] ?? ""))));
  const line = (r: string[]) => "| " + r.map((s, c) => pad(s, widths[c], t.align[c])).join(" | ") + " |";
  return [
    line(cells[0]),
    "| " + widths.map((w, c) => delimiter(w, t.align[c])).join(" | ") + " |",
    ...cells.slice(1).map(line),
  ].join("\n");
}

/** A new table with `cols` columns (headers "Column 1"…) and `rows` empty body rows. */
export function emptyTable(rows: number, cols: number): Table {
  return {
    rows: [
      Array.from({ length: cols }, (_, i) => `Column ${i + 1}`),
      ...Array.from({ length: rows }, () => Array<string>(cols).fill("")),
    ],
    align: Array<Align>(cols).fill(null),
  };
}

const clone = (t: Table): Table => ({ rows: t.rows.map((r) => [...r]), align: [...t.align] });

/** Inserts an empty body row at index `at` (1 = first body row). */
export function insertRow(t: Table, at: number): Table {
  const n = clone(t);
  n.rows.splice(Math.max(1, Math.min(at, n.rows.length)), 0, Array<string>(n.align.length).fill(""));
  return n;
}

/** Deletes body row `r`; the header row can't be deleted. */
export function deleteRow(t: Table, r: number): Table {
  if (r < 1 || r >= t.rows.length) return t;
  const n = clone(t);
  n.rows.splice(r, 1);
  return n;
}

/** Moves body row `r` up (-1) or down (+1), staying below the header. */
export function moveRow(t: Table, r: number, dir: -1 | 1): Table {
  const to = r + dir;
  if (r < 1 || to < 1 || to >= t.rows.length) return t;
  const n = clone(t);
  [n.rows[r], n.rows[to]] = [n.rows[to], n.rows[r]];
  return n;
}

export function insertColumn(t: Table, at: number): Table {
  const n = clone(t);
  const c = Math.max(0, Math.min(at, n.align.length));
  n.rows.forEach((r) => r.splice(c, 0, ""));
  n.align.splice(c, 0, null);
  return n;
}

/** Deletes column `c`, unless it is the only one. */
export function deleteColumn(t: Table, c: number): Table {
  if (t.align.length <= 1 || c < 0 || c >= t.align.length) return t;
  const n = clone(t);
  n.rows.forEach((r) => r.splice(c, 1));
  n.align.splice(c, 1);
  return n;
}

export function moveColumn(t: Table, c: number, dir: -1 | 1): Table {
  const to = c + dir;
  if (c < 0 || to < 0 || to >= t.align.length) return t;
  const n = clone(t);
  const swap = <T>(a: T[]) => ([a[c], a[to]] = [a[to], a[c]]);
  n.rows.forEach(swap);
  swap(n.align);
  return n;
}

export function setAlign(t: Table, c: number, align: Align): Table {
  const n = clone(t);
  n.align[c] = align;
  return n;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sorts the body rows by column `c` (numbers in order, ignoring case); empty cells last. */
export function sortRows(t: Table, c: number, dir: "asc" | "desc"): Table {
  const n = clone(t);
  const body = n.rows.slice(1);
  body.sort((a, b) => {
    const x = a[c] ?? "";
    const y = b[c] ?? "";
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    const nx = Number(x.replace(/,/g, ""));
    const ny = Number(y.replace(/,/g, ""));
    const cmp = !isNaN(nx) && !isNaN(ny) ? nx - ny : collator.compare(x, y);
    return dir === "asc" ? cmp : -cmp;
  });
  n.rows = [n.rows[0], ...body];
  return n;
}

/** Puts a block of values (e.g. pasted from a spreadsheet) into the table at row `r`, column `c`, growing it to fit. */
export function pasteGrid(t: Table, r: number, c: number, grid: string[][]): Table {
  let n = clone(t);
  const cols = Math.max(...grid.map((g) => g.length));
  while (n.align.length < c + cols) n = insertColumn(n, n.align.length);
  while (n.rows.length < r + grid.length) n = insertRow(n, n.rows.length);
  grid.forEach((row, i) => row.forEach((v, j) => (n.rows[r + i][c + j] = v)));
  return n;
}

/** A table from rows of values; the first row becomes the header. */
export function tableFromGrid(grid: string[][]): Table {
  const cols = Math.max(1, ...grid.map((r) => r.length));
  const rows = grid.map((r) => [...r, ...Array<string>(cols - r.length).fill("")]);
  if (rows.length === 0) rows.push(Array<string>(cols).fill(""));
  return { rows, align: Array<Align>(cols).fill(null) };
}

/**
 * Splits tab- or comma-separated text into rows of cells. Commas follow CSV
 * quoting ("a, b" and "" for a quote); tabs are what spreadsheets copy.
 */
export function parseDelimited(text: string, sep: "\t" | "," = text.includes("\t") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

/**
 * Whether pasted text looks like cells copied from a spreadsheet: at least two
 * lines, each with the same number (two or more) of tab-separated cells.
 */
export function looksLikeSpreadsheet(text: string): boolean {
  if (!text.includes("\t")) return false;
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines.length < 2) return false;
  const n = lines[0].split("\t").length;
  return n >= 2 && lines.every((l) => l.split("\t").length === n);
}

/** The table as CSV, quoting cells that need it. */
export function tableToCsv(t: Table): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return t.rows.map((r) => r.map(q).join(",")).join("\n");
}

/** The row and column of the cell at `offset` in a table's source (the delimiter line counts as the header). */
export function cellAt(text: string, offset: number): { row: number; col: number } {
  const lines = text.split("\n");
  let pos = 0;
  let line = 0;
  while (line < lines.length - 1 && pos + lines[line].length < offset) {
    pos += lines[line].length + 1;
    line++;
  }
  const row = line <= 1 ? 0 : line - 1;
  const before = lines[line].slice(0, Math.max(0, offset - pos));
  const trimmed = before.trimStart();
  let pipes = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\") i++;
    else if (trimmed[i] === "|") pipes++;
  }
  const lead = lines[line].trimStart().startsWith("|") ? 1 : 0;
  const cols = splitRow(lines[line]).length;
  return { row, col: Math.max(0, Math.min(cols - 1, pipes - lead)) };
}

/** Where the text of cell (`row`, `col`) starts in `formatTable` output, for putting the cursor there. */
export function cellOffset(text: string, row: number, col: number): number {
  const lines = text.split("\n");
  const line = row === 0 ? 0 : row + 1;
  let pos = 0;
  for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
  const l = lines[Math.min(line, lines.length - 1)];
  let seen = 0;
  for (let i = 0; i < l.length; i++) {
    if (l[i] === "\\") i++;
    else if (l[i] === "|") {
      if (seen === col) {
        let j = i + 1;
        while (l[j] === " ") j++;
        // An empty cell: just after "| ".
        return pos + (l[j] === "|" || j >= l.length ? Math.min(i + 2, l.length) : j);
      }
      seen++;
    }
  }
  return pos + l.length;
}
