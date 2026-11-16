import { completionStatus } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, type EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { Command } from "./formatting";
import { focusedTableRange, gridEdit } from "./table-grid";
import {
  cellAt,
  cellOffset,
  deleteRow,
  formatTable,
  insertRow,
  looksLikeSpreadsheet,
  parseDelimited,
  parseTable,
  tableFromGrid,
  tableToCsv,
  type Table,
} from "./table-model";

/**
 * Table helpers for editing tables as markdown (source mode, or live preview
 * with tables shown as markdown): Tab and Enter move between cells and tidy
 * the columns, and cells copied from a spreadsheet paste as a table.
 */

/** The lines of the table around `pos`, or null. */
export function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 50);
  if (!tree) return null;
  for (const side of [-1, 1] as const) {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "Table") return { from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to };
      if (n.name === "FencedCode" || n.name === "CodeBlock") return null;
    }
  }
  return null;
}

function inCode(state: EditorState, pos: number): boolean {
  const tree = ensureSyntaxTree(state, pos, 50);
  for (let n = tree?.resolveInner(pos, -1) ?? null; n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return true;
  }
  return false;
}

/** Replaces the table at the cursor with `edit(table, row, col)`'s result and moves the cursor to the returned cell. */
function editTable(
  edit: (t: Table, row: number, col: number) => { table: Table; row: number; col: number } | null,
): Command {
  return ({ state, dispatch }) => {
    const sel = state.selection.main;
    if (!sel.empty) return false;
    const range = tableAt(state, sel.head);
    if (!range) return false;
    const source = state.sliceDoc(range.from, range.to);
    const table = parseTable(source);
    if (!table) return false;
    const { row, col } = cellAt(source, sel.head - range.from);
    const next = edit(table, row, col);
    if (!next) return false;
    const text = formatTable(next.table);
    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert: text },
        selection: EditorSelection.cursor(range.from + cellOffset(text, next.row, next.col)),
        scrollIntoView: true,
        userEvent: "input.table",
      }),
    );
    return true;
  };
}

/** Tab: the next cell (a new row after the last one). */
export const nextCell = editTable((table, row, col) => {
  const cols = table.align.length;
  const i = row * cols + col + 1;
  if (i >= table.rows.length * cols) return { table: insertRow(table, table.rows.length), row: table.rows.length, col: 0 };
  return { table, row: Math.floor(i / cols), col: i % cols };
});

/** Shift+Tab: the previous cell. */
export const previousCell = editTable((table, row, col) => {
  const cols = table.align.length;
  const i = Math.max(0, row * cols + col - 1);
  return { table, row: Math.floor(i / cols), col: i % cols };
});

/** Tidies the columns of the table at the cursor. */
export const formatTableAtCursor = editTable((table, row, col) => ({ table, row, col }));

/**
 * Enter in a table: the same column in the next row (adding one at the end).
 * Enter on an empty last row removes it and leaves the table.
 */
export const nextRow: Command = (target) => {
  const { state, dispatch } = target;
  const sel = state.selection.main;
  const range = sel.empty ? tableAt(state, sel.head) : null;
  if (!range || sel.head === range.from) return false;
  const source = state.sliceDoc(range.from, range.to);
  const table = parseTable(source);
  if (!table) return false;
  const { row } = cellAt(source, sel.head - range.from);
  const last = table.rows.length - 1;
  if (row === last && row >= 1 && table.rows[row].every((c) => !c)) {
    const text = formatTable(deleteRow(table, row));
    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert: text + "\n" },
        selection: EditorSelection.cursor(range.from + text.length + 1),
        scrollIntoView: true,
        userEvent: "input.table",
      }),
    );
    return true;
  }
  // From the delimiter line (just typed), start the first row at its first cell.
  const onDelimiter = state.doc.lineAt(sel.head).number === state.doc.lineAt(range.from).number + 1;
  return editTable((t, r, c) => {
    const col = onDelimiter ? 0 : c;
    return r === t.rows.length - 1 ? { table: insertRow(t, t.rows.length), row: r + 1, col } : { table: t, row: Math.max(1, r + 1), col };
  })(target);
};

/** Turns the selected comma- or tab-separated lines into a table (the first line becomes the headings). */
export const linesToTable: Command = ({ state, dispatch }) => {
  const sel = state.selection.main;
  const from = state.doc.lineAt(sel.from).from;
  const to = state.doc.lineAt(sel.to).to;
  const text = state.sliceDoc(from, to);
  if (!text.trim()) return false;
  const table = formatTable(tableFromGrid(parseDelimited(text)));
  dispatch(
    state.update({ changes: { from, to, insert: table }, selection: EditorSelection.cursor(from + 2), scrollIntoView: true, userEvent: "input.table" }),
  );
  return true;
};

/** Turns the table at the cursor into comma-separated lines. */
export const tableToLines: Command = ({ state, dispatch }) => {
  const range = tableAt(state, state.selection.main.head);
  const table = range && parseTable(state.sliceDoc(range.from, range.to));
  if (!range || !table) return false;
  const csv = tableToCsv(table);
  dispatch(state.update({ changes: { from: range.from, to: range.to, insert: csv }, selection: EditorSelection.range(range.from, range.from + csv.length), userEvent: "input.table" }));
  return true;
};

/** Cells copied from a spreadsheet become a markdown table on its own lines. */
const spreadsheetPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const data = event.clipboardData;
    if (!data || data.files.length > 0) return false;
    const text = data.getData("text/plain");
    const { from, to } = view.state.selection.main;
    if (!looksLikeSpreadsheet(text) || inCode(view.state, from) || tableAt(view.state, from)) return false;
    event.preventDefault();
    const table = formatTable(tableFromGrid(parseDelimited(text, "\t")));
    const before = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
    const after = to < view.state.doc.length && view.state.sliceDoc(to, to + 1) !== "\n" ? "\n" : "";
    view.dispatch({
      changes: { from, to, insert: before + table + after },
      selection: EditorSelection.cursor(from + before.length + table.length),
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    return true;
  },
});

/** Leaves keys to the autocomplete list while it is open. */
const unlessCompleting =
  (cmd: Command): Command =>
  (target) =>
    completionStatus(target.state) !== "active" && cmd(target);

export function tableEditing() {
  return [
    spreadsheetPaste,
    // Ahead of markdown's own Enter (continuing lists) and indentation on Tab.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: unlessCompleting(nextCell), shift: unlessCompleting(previousCell) },
        { key: "Enter", run: unlessCompleting(nextRow) },
        { key: "Mod-Alt-t", run: formatTableAtCursor },
      ]),
    ),
  ];
}

/** Runs a table command from the command palette, on the table being edited as a grid if there is one. */
export function editTableSource(view: EditorView, kind: "format" | "from-lines" | "to-lines"): boolean {
  const grid = focusedTableRange(view);
  if (grid && kind !== "from-lines") view.dispatch({ selection: { anchor: grid.from + 2 }, annotations: gridEdit.of(true) });
  const cmd = kind === "format" ? formatTableAtCursor : kind === "from-lines" ? linesToTable : tableToLines;
  const done = cmd(view);
  view.focus();
  return done;
}
