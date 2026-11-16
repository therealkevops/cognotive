import { EditorSelection, type ChangeSpec, type EditorState, type Line } from "@codemirror/state";
import { emptyTable, formatTable } from "./table-model";

/** A CodeMirror state command: works with an EditorView or any {state, dispatch}. */
export type Command = (target: {
  state: EditorState;
  dispatch: (tr: ReturnType<EditorState["update"]>) => void;
}) => boolean;

/**
 * Wraps each selection in `marker` (e.g. "**"), or unwraps it if it is already
 * wrapped — whether the markers sit just inside or just outside the selection.
 * With an empty selection, inserts a pair and puts the cursor between them.
 */
export function toggleInline(marker: string): Command {
  const n = marker.length;
  return ({ state, dispatch }) => {
    const tr = state.changeByRange((range) => {
      const { from, to } = range;
      const text = state.sliceDoc(from, to);
      // Markers inside the selection: "**bold**" selected.
      if (text.length >= 2 * n && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: [
            { from, to: from + n },
            { from: to - n, to },
          ],
          range: EditorSelection.range(from, to - 2 * n),
        };
      }
      // Markers just outside the selection (or around the cursor).
      if (
        state.sliceDoc(from - n, from) === marker &&
        state.sliceDoc(to, to + n) === marker &&
        // Don't treat "**" as two "*" italics markers.
        !(n === 1 && state.sliceDoc(from - 2, from - 1) === marker && state.sliceDoc(to + 1, to + 2) === marker)
      ) {
        return {
          changes: [
            { from: from - n, to: from },
            { from: to, to: to + n },
          ],
          range: EditorSelection.range(from - n, to - n),
        };
      }
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + n, to + n),
      };
    });
    dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

function selectedLines(state: EditorState): Line[] {
  const seen = new Set<number>();
  const lines: Line[] = [];
  for (const r of state.selection.ranges) {
    const end = state.doc.lineAt(r.to);
    for (let l = state.doc.lineAt(r.from); ; l = state.doc.line(l.number + 1)) {
      if (!seen.has(l.number)) {
        seen.add(l.number);
        lines.push(l);
      }
      if (l.number >= end.number) break;
    }
  }
  return lines;
}

const HEADING = /^#{1,6}\s+/;

/**
 * Sets the heading level of every selected line (1–6). Applying the level a line
 * already has turns it back into a paragraph; level 0 always does.
 */
export function setHeading(level: number): Command {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const allAtLevel =
      level > 0 &&
      lines.every((l) => new RegExp(`^#{${level}}\\s`).test(l.text) && !l.text.startsWith("#".repeat(level + 1)));
    const prefix = level > 0 && !allAtLevel ? "#".repeat(level) + " " : "";
    const changes: ChangeSpec[] = lines.map((l) => {
      const existing = HEADING.exec(l.text)?.[0].length ?? 0;
      return { from: l.from, to: l.from + existing, insert: prefix };
    });
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

export type LineKind = "bullet" | "ordered" | "task" | "quote";

const LIST_PREFIX = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/;
const QUOTE_PREFIX = /^(\s*)>\s?/;

function prefixFor(kind: LineKind, index: number): string {
  switch (kind) {
    case "bullet":
      return "- ";
    case "ordered":
      return `${index + 1}. `;
    case "task":
      return "- [ ] ";
    case "quote":
      return "> ";
  }
}

function hasKind(text: string, kind: LineKind): boolean {
  switch (kind) {
    case "bullet":
      return /^\s*[-*+]\s+(?!\[[ xX]\])/.test(text);
    case "ordered":
      return /^\s*\d+[.)]\s+/.test(text);
    case "task":
      return /^\s*[-*+]\s+\[[ xX]\]\s+/.test(text);
    case "quote":
      return /^\s*>/.test(text);
  }
}

/**
 * Turns the selected lines into a bullet, numbered, task list or quote. If every
 * non-blank line already is one, removes it instead. Switching between list
 * kinds replaces the old marker; indentation is kept.
 */
export function toggleLinePrefix(kind: LineKind): Command {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state).filter(
      (l, _, all) => all.length === 1 || l.text.trim() !== "",
    );
    const remove = lines.every((l) => hasKind(l.text, kind));
    const pattern = kind === "quote" ? QUOTE_PREFIX : LIST_PREFIX;
    const changes: ChangeSpec[] = lines.map((l, i) => {
      const m = pattern.exec(l.text);
      const indent = m?.[1] ?? /^\s*/.exec(l.text)![0];
      const oldLen = m ? m[0].length : indent.length;
      return {
        from: l.from + indent.length,
        to: l.from + oldLen,
        insert: remove ? "" : prefixFor(kind, i),
      };
    });
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** Toggles `- [ ]` ↔ `- [x]` on the selected task lines. Returns false if none. */
export const toggleTaskDone: Command = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  for (const l of selectedLines(state)) {
    const m = /^(\s*[-*+]\s+\[)([ xX])\]/.exec(l.text);
    if (m) changes.push({ from: l.from + m[1].length, to: l.from + m[1].length + 1, insert: m[2] === " " ? "x" : " " });
  }
  if (!changes.length) return false;
  dispatch(state.update({ changes, userEvent: "input.format" }));
  return true;
};

/** Wraps the selection as link text and selects the URL placeholder. */
export const insertLink: Command = ({ state, dispatch }) => {
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const isUrl = /^https?:\/\/\S+$/.test(text);
    const label = isUrl ? "" : text;
    const url = isUrl ? text : "url";
    const insert = `[${label}](${url})`;
    const sel = isUrl || !label
      ? EditorSelection.cursor(range.from + 1)
      : EditorSelection.range(range.from + label.length + 3, range.from + label.length + 3 + url.length);
    return { changes: { from: range.from, to: range.to, insert }, range: sel };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/** Inserts a block on its own lines at the cursor, replacing the selection. */
function insertBlock(build: (selected: string) => { text: string; cursor: number }): Command {
  return ({ state, dispatch }) => {
    const { from, to } = state.selection.main;
    const { text, cursor } = build(state.sliceDoc(from, to));
    const before = from > 0 && state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
    const after = to < state.doc.length && state.sliceDoc(to, to + 1) !== "\n" ? "\n" : "";
    dispatch(
      state.update({
        changes: { from, to, insert: before + text + after },
        selection: EditorSelection.cursor(from + before.length + cursor),
        scrollIntoView: true,
        userEvent: "input.format",
      }),
    );
    return true;
  };
}

export const insertCodeBlock = insertBlock((sel) => ({
  text: "```\n" + sel + "\n```",
  cursor: 3,
}));

/** Inserts a table with `cols` columns and `rows` empty rows below the headings. */
export const insertTableOf = (rows: number, cols: number) =>
  insertBlock(() => ({ text: formatTable(emptyTable(rows, cols)), cursor: 2 }));

export const insertTable = insertTableOf(2, 2);

export const insertHorizontalRule = insertBlock(() => ({ text: "\n---\n", cursor: 5 }));

export const toggleBold = toggleInline("**");
export const toggleItalic = toggleInline("*");
export const toggleStrikethrough = toggleInline("~~");
export const toggleHighlight = toggleInline("==");
export const toggleInlineCode = toggleInline("`");
