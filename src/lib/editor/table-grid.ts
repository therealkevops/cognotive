import { completionStatus } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { Annotation, Facet, Prec, StateField } from "@codemirror/state";
import { EditorView, keymap, WidgetType } from "@codemirror/view";
import { hasModKey, openHow } from "../links/open";
import { splitLinkText } from "../links/parse";
import {
  cellAt,
  deleteColumn,
  deleteRow,
  formatTable,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseDelimited,
  parseTable,
  pasteGrid,
  setAlign,
  sortRows,
  type Table,
} from "./table-model";
import { fillAssets, linkHost, type LinkHost } from "./wikilinks";

/**
 * Tables edited as a grid in live preview. Each cell is a small plain-text
 * editor: it shows the cell rendered, and its markdown while it has focus.
 * Every edit is written straight back to the note as a formatted markdown
 * table, so undo, autosave and sync see ordinary text changes.
 */

/** Whether live preview edits tables as a grid (true) or as markdown. */
export const tableGridOn = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

/** Marks transactions made by a grid, so the grid doesn't react to its own edits. */
export const gridEdit = Annotation.define<boolean>();

/**
 * Whether the user is typing in the text (so a table being typed by hand stays
 * text until Enter or Tab moves on, or the cursor leaves it).
 */
export const typingText = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (tr.annotation(gridEdit) || tr.isUserEvent("input.table")) return false;
    if (tr.isUserEvent("input.type") || tr.isUserEvent("delete") || tr.isUserEvent("input.complete")) return true;
    if (tr.docChanged || tr.selection) return false;
    return value;
  },
});

const registry = new WeakMap<EditorView, Set<GridController>>();
const controllers = new WeakMap<HTMLElement, GridController>();
/** Focus to restore if CodeMirror redraws a grid from scratch while a cell is being edited. */
const pendingFocus = new WeakMap<EditorView, { from: number; row: number; col: number; caret: number }>();

type Caret = number | "start" | "end" | "all";

function makeEditable(el: HTMLElement) {
  try {
    el.contentEditable = "plaintext-only";
  } catch {
    el.contentEditable = "true";
  }
  if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
}

function caretOffset(el: HTMLElement): { start: number; end: number } | null {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const pre = el.ownerDocument.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start, end: start + r.toString().length };
}

function placeCaret(el: HTMLElement, at: Exclude<Caret, "all">) {
  const sel = el.ownerDocument.getSelection();
  if (!sel) return;
  const len = el.textContent?.length ?? 0;
  const offset = at === "start" ? 0 : at === "end" ? len : Math.min(at, len);
  const range = el.ownerDocument.createRange();
  const text = el.firstChild;
  if (text && text.nodeType === Node.TEXT_NODE) range.setStart(text, offset);
  else range.setStart(el, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function selectAll(el: HTMLElement) {
  const sel = el.ownerDocument.getSelection();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

const insertText = (el: HTMLElement, text: string) => el.ownerDocument.execCommand("insertText", false, text);

/** Wraps the selection in a cell with `marker` ("**"), or puts the caret between a new pair. */
function wrapSelection(el: HTMLElement, marker: string) {
  const sel = el.ownerDocument.getSelection()?.toString() ?? "";
  insertText(el, marker + sel + marker);
  if (!sel) {
    const at = caretOffset(el);
    if (at) placeCaret(el, at.start - marker.length);
  }
}

interface MenuItem {
  label: string;
  run?: () => void;
  disabled?: boolean;
}

class GridController {
  readonly dom: HTMLDivElement;
  private cells: HTMLElement[][] = [];
  private html: string[][] = [];
  private focus: { row: number; col: number } | null = null;
  private table: Table;
  private renderToken = 0;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private menu: HTMLElement | null = null;
  private closeMenuListener: ((e: Event) => void) | null = null;

  constructor(
    readonly view: EditorView,
    public source: string,
    public from: number,
  ) {
    this.table = parseTable(source) ?? { rows: [[""]], align: [null] };
    this.dom = document.createElement("div");
    this.dom.className = "cm-table-grid prose-note";
    this.dom.contentEditable = "false";
    controllers.set(this.dom, this);
    let set = registry.get(view);
    if (!set) registry.set(view, (set = new Set()));
    set.add(this);
    this.build();
    this.renderCells();
    const pending = pendingFocus.get(view);
    if (pending && pending.from === from) {
      pendingFocus.delete(view);
      queueMicrotask(() => this.focusCell(pending.row, pending.col, pending.caret));
    }
  }

  get to() {
    return this.from + this.source.length;
  }

  private get host(): LinkHost | null {
    return this.view.state.facet(linkHost);
  }

  /** A new version of the table's source (from undo, or edits elsewhere in the note). */
  update(source: string, from: number) {
    this.from = from;
    if (source === this.source) return;
    this.source = source;
    const t = parseTable(source);
    if (!t) return;
    this.table = t;
    const focus = this.focus;
    this.build();
    this.renderCells();
    if (focus) this.focusCell(Math.min(focus.row, t.rows.length - 1), Math.min(focus.col, t.align.length - 1), "end");
  }

  destroy() {
    this.closeMenu();
    clearTimeout(this.renderTimer);
    registry.get(this.view)?.delete(this);
    if (this.focus) {
      const el = this.cells[this.focus.row]?.[this.focus.col];
      pendingFocus.set(this.view, { from: this.from, ...this.focus, caret: el ? (caretOffset(el)?.start ?? 0) : 0 });
    }
  }

  /* ---------- DOM ---------- */

  private build() {
    const t = this.table;
    this.dom.replaceChildren();
    const scroll = document.createElement("div");
    scroll.className = "cm-table-scroll";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    this.cells = t.rows.map((row, r) => {
      const tr = document.createElement("tr");
      const cells = row.map((text, c) => {
        const td = document.createElement(r === 0 ? "th" : "td");
        if (t.align[c]) td.style.textAlign = t.align[c]!;
        const cell = document.createElement("div");
        cell.className = "cm-table-cell";
        makeEditable(cell);
        cell.setAttribute("role", "textbox");
        cell.spellcheck = true;
        cell.textContent = text;
        this.listen(cell, r, c);
        td.append(cell);
        tr.append(td);
        return cell;
      });
      (r === 0 ? thead : tbody).append(tr);
      return cells;
    });
    t.align.forEach((_, c) => this.labelColumn(c));
    table.append(thead);
    if (t.rows.length > 1) table.append(tbody);
    scroll.append(table);

    const addCol = this.button("cm-table-add-col", "Add column", "+", () => {
      this.table = insertColumn(this.table, this.table.align.length);
      this.structural(0, this.table.align.length - 1);
    });
    const addRow = this.button("cm-table-add-row", "Add row", "+", () => {
      this.table = insertRow(this.table, this.table.rows.length);
      this.structural(this.table.rows.length - 1, 0);
    });
    const options = this.button("cm-table-options", "Table options", "⋯", () => {
      const f = this.focus ?? { row: 0, col: 0 };
      const rect = options.getBoundingClientRect();
      this.openMenu(f.row, f.col, rect.left, rect.bottom + 4);
    });
    const row = document.createElement("div");
    row.className = "cm-table-row";
    row.append(scroll, addCol);
    this.dom.append(options, row, addRow);
  }

  /** Names a column's cells for screen readers: "Heading 2", then "Row 1, Price"… */
  private labelColumn(c: number) {
    const heading = this.table.rows[0][c] || `column ${c + 1}`;
    this.cells.forEach((row, r) => row[c]?.setAttribute("aria-label", r === 0 ? `Heading ${c + 1}` : `Row ${r}, ${heading}`));
  }

  private button(cls: string, label: string, text: string, run: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.textContent = text;
    b.tabIndex = -1;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the cell
    b.addEventListener("click", (e) => {
      e.preventDefault();
      run();
    });
    return b;
  }

  /** Shows each cell rendered as markdown (except the one being edited). */
  private renderCells(delay = 0) {
    clearTimeout(this.renderTimer);
    const host = this.host;
    if (!host?.renderHtml) return;
    const token = ++this.renderToken;
    const go = () => {
      void host.renderHtml!(formatTable(this.table)).then((html) => {
        if (token !== this.renderToken) return;
        const tpl = document.createElement("template");
        tpl.innerHTML = html; // sanitized by the markdown pipeline
        this.html = [...tpl.content.querySelectorAll("tr")].map((tr) =>
          [...tr.querySelectorAll("th, td")].map((c) => c.innerHTML),
        );
        this.cells.forEach((row, r) => row.forEach((_, c) => this.showRendered(r, c)));
      });
    };
    if (delay) this.renderTimer = setTimeout(go, delay);
    else go();
  }

  private showRendered(r: number, c: number) {
    const el = this.cells[r]?.[c];
    const html = this.html[r]?.[c];
    if (!el || html === undefined || (this.focus?.row === r && this.focus.col === c)) return;
    el.innerHTML = html;
    const host = this.host;
    if (host) fillAssets(el, host);
  }

  /* ---------- Cell events ---------- */

  private listen(cell: HTMLElement, r: number, c: number) {
    cell.addEventListener("mousedown", (e) => {
      const a = (e.target as HTMLElement).closest("a");
      if (!a || this.focus?.row === r && this.focus.col === c) return;
      const follow = hasModKey(e) || this.host?.clickFollows?.() !== false;
      if (!follow) return;
      e.preventDefault();
      if (a.classList.contains("internal-link")) {
        const parts = splitLinkText(a.dataset.href ?? "");
        this.host?.open(parts.target, parts.heading ?? (parts.block ? `^${parts.block}` : undefined), openHow(e));
      } else if (a.getAttribute("href")) window.open(a.getAttribute("href")!, "_blank", "noopener");
    });
    cell.addEventListener("focus", () => {
      this.closeMenu();
      if (this.focus?.row === r && this.focus.col === c) return;
      this.focus = { row: r, col: c };
      const raw = this.table.rows[r][c];
      if (cell.textContent !== raw) {
        cell.textContent = raw;
        placeCaret(cell, "end");
      }
      this.dom.classList.add("cm-table-editing");
    });
    cell.addEventListener("blur", () => {
      if (this.focus?.row !== r || this.focus.col !== c) return;
      this.focus = null;
      this.dom.classList.remove("cm-table-editing");
      this.showRendered(r, c);
    });
    cell.addEventListener("input", () => {
      this.table.rows[r][c] = (cell.textContent ?? "").replace(/\n/g, "<br>");
      this.commit(true);
      if (r === 0) this.labelColumn(c);
      this.renderCells(300);
    });
    cell.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      e.preventDefault();
      if (!text) return;
      const clean = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
      if (clean.includes("\t") || clean.includes("\n")) {
        const grid = clean.includes("\t") ? parseDelimited(clean, "\t") : clean.split("\n").map((l) => [l.trim()]);
        if (grid.length > 1 || grid[0].length > 1) {
          // Keep what's been typed in this cell, then spread the block from here.
          this.table.rows[r][c] = cell.textContent ?? "";
          this.table = pasteGrid(this.table, r, c, grid);
          this.structural(r + grid.length - 1, c);
          return;
        }
      }
      insertText(cell, clean);
    });
    cell.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const rect = cell.getBoundingClientRect();
      const fromKeyboard = e.clientX === 0 && e.clientY === 0;
      this.openMenu(r, c, fromKeyboard ? rect.left : e.clientX, fromKeyboard ? rect.bottom : e.clientY);
    });
    cell.addEventListener("keydown", (e) => this.onKey(e, cell, r, c));
  }

  private onKey(e: KeyboardEvent, cell: HTMLElement, r: number, c: number) {
    if (e.isComposing) return;
    const rows = this.table.rows.length;
    const cols = this.table.align.length;
    const mod = hasModKey(e);
    const caret = caretOffset(cell);
    const len = cell.textContent?.length ?? 0;
    const collapsed = caret && caret.start === caret.end;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (e.key === "Tab") {
      handled();
      const i = r * cols + c + (e.shiftKey ? -1 : 1);
      if (i < 0) return;
      if (i >= rows * cols) {
        this.table = insertRow(this.table, rows);
        this.structural(rows, 0);
      } else this.focusCell(Math.floor(i / cols), i % cols, "all"); // like a spreadsheet: typing replaces
    } else if (e.key === "Enter" && e.shiftKey && !mod) {
      handled();
      insertText(cell, "<br>");
    } else if (e.key === "Enter" && mod) {
      handled();
      this.exit("down");
    } else if (e.key === "Enter") {
      handled();
      if (r === rows - 1) {
        this.table = insertRow(this.table, rows);
        this.structural(rows, c);
      } else this.focusCell(r + 1, c, "end");
    } else if (e.key === "Escape") {
      handled();
      this.exit("down");
    } else if (e.altKey && !mod && e.key.startsWith("Arrow")) {
      handled();
      // Alt+arrows move the row or column.
      const move =
        e.key === "ArrowUp" && r > 1 ? { t: moveRow(this.table, r, -1), r: r - 1, c }
        : e.key === "ArrowDown" && r >= 1 && r < rows - 1 ? { t: moveRow(this.table, r, 1), r: r + 1, c }
        : e.key === "ArrowLeft" && c > 0 ? { t: moveColumn(this.table, c, -1), r, c: c - 1 }
        : e.key === "ArrowRight" && c < cols - 1 ? { t: moveColumn(this.table, c, 1), r, c: c + 1 }
        : null;
      if (move) {
        this.table = move.t;
        this.structural(move.r, move.c);
      }
    } else if (e.key === "ArrowUp" && !e.shiftKey && !mod) {
      handled();
      if (r === 0) this.exit("up");
      else this.focusCell(r - 1, c, "end");
    } else if (e.key === "ArrowDown" && !e.shiftKey && !mod) {
      handled();
      if (r === rows - 1) this.exit("down");
      else this.focusCell(r + 1, c, "end");
    } else if (e.key === "ArrowLeft" && !e.shiftKey && !mod && collapsed && caret.start === 0) {
      handled();
      if (c > 0) this.focusCell(r, c - 1, "end");
      else if (r > 0) this.focusCell(r - 1, cols - 1, "end");
      else this.exit("up");
    } else if (e.key === "ArrowRight" && !e.shiftKey && !mod && collapsed && caret.start === len) {
      handled();
      if (c < cols - 1) this.focusCell(r, c + 1, "start");
      else if (r < rows - 1) this.focusCell(r + 1, 0, "start");
      else this.exit("down");
    } else if (mod && !e.altKey && !e.shiftKey && e.key === "a") {
      handled();
      selectAll(cell);
    } else if (mod && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      handled();
      const back = e.key === "z" && !e.shiftKey;
      (back ? undo : redo)(this.view);
    } else if (mod && !e.altKey) {
      const marker =
        e.key === "b" ? "**" : e.key === "i" ? "*" : e.key === "`" ? "`" : e.shiftKey && e.key.toLowerCase() === "h" ? "==" : e.shiftKey && e.key.toLowerCase() === "x" ? "~~" : null;
      if (marker) {
        handled();
        wrapSelection(cell, marker);
      }
    }
  }

  /* ---------- Writing back ---------- */

  /** Writes the table back. Typing is "input.type" so undo groups it like ordinary typing. */
  private commit(typing = false) {
    const md = formatTable(this.table);
    if (md === this.source) return;
    const to = this.to;
    this.source = md;
    this.view.dispatch({
      changes: { from: this.from, to, insert: md },
      annotations: [gridEdit.of(true)],
      userEvent: typing ? "input.type.table" : "input.table",
    });
  }

  /** After changing rows or columns: write back, redraw and focus a cell. */
  private structural(row: number, col: number) {
    this.commit();
    this.build();
    this.renderCells();
    this.focus = null;
    this.focusCell(row, col, "end");
  }

  focusCell(row: number, col: number, caret: Caret) {
    const el = this.cells[row]?.[col];
    if (!el) return;
    el.focus({ preventScroll: false });
    if (caret === "all") selectAll(el);
    else placeCaret(el, caret);
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Focus the cell at an offset in the table's source (the editor's cursor moved into the table). */
  focusAt(offset: number) {
    const { row, col } = cellAt(this.source, offset);
    this.focusCell(row, col, offset >= this.source.length ? "end" : "start");
    // A new table's "Column 1" heading is selected, so typing replaces it.
    const el = this.cells[row]?.[col];
    if (el && row === 0 && /^Column \d+$/.test(this.table.rows[0][col])) selectAll(el);
  }

  /** Leaves the table for the line above or below, adding one at the start or end of the note. */
  exit(dir: "up" | "down") {
    const view = this.view;
    if (dir === "up") {
      if (this.from > 0) view.dispatch({ selection: { anchor: this.from - 1 }, annotations: gridEdit.of(true), scrollIntoView: true });
      else view.dispatch({ changes: { from: 0, insert: "\n" }, selection: { anchor: 0 }, annotations: gridEdit.of(true), scrollIntoView: true });
    } else {
      const to = this.to;
      if (to < view.state.doc.length) view.dispatch({ selection: { anchor: to + 1 }, annotations: gridEdit.of(true), scrollIntoView: true });
      else view.dispatch({ changes: { from: to, insert: "\n" }, selection: { anchor: to + 1 }, annotations: gridEdit.of(true), scrollIntoView: true });
    }
    view.focus();
  }

  /** Wraps the selection in the focused cell (formatting buttons while a cell is being edited). */
  wrapFocused(marker: string): boolean {
    if (!this.focus) return false;
    const el = this.cells[this.focus.row][this.focus.col];
    wrapSelection(el, marker);
    return true;
  }

  hasFocus() {
    return this.focus !== null;
  }

  /* ---------- Menu ---------- */

  private openMenu(r: number, c: number, x: number, y: number) {
    this.closeMenu();
    const t = this.table;
    const rows = t.rows.length;
    const cols = t.align.length;
    const op = (f: (t: Table) => Table, row: number, col: number) => () => {
      this.table = f(this.table);
      this.structural(row, col);
    };
    const groups: MenuItem[][] = [
      [
        { label: "Insert row above", run: op((t) => insertRow(t, r), Math.max(1, r), c), disabled: r === 0 },
        { label: "Insert row below", run: op((t) => insertRow(t, r + 1), r + 1, c) },
        { label: "Move row up", run: op((t) => moveRow(t, r, -1), r - 1, c), disabled: r <= 1 },
        { label: "Move row down", run: op((t) => moveRow(t, r, 1), r + 1, c), disabled: r === 0 || r >= rows - 1 },
        { label: "Delete row", run: op((t) => deleteRow(t, r), Math.min(r, rows - 2), c), disabled: r === 0 },
      ],
      [
        { label: "Insert column left", run: op((t) => insertColumn(t, c), r, c) },
        { label: "Insert column right", run: op((t) => insertColumn(t, c + 1), r, c + 1) },
        { label: "Move column left", run: op((t) => moveColumn(t, c, -1), r, c - 1), disabled: c === 0 },
        { label: "Move column right", run: op((t) => moveColumn(t, c, 1), r, c + 1), disabled: c >= cols - 1 },
        { label: "Delete column", run: op((t) => deleteColumn(t, c), r, Math.min(c, cols - 2)), disabled: cols <= 1 },
      ],
      [
        { label: "Align left", run: op((t) => setAlign(t, c, "left"), r, c) },
        { label: "Align centre", run: op((t) => setAlign(t, c, "center"), r, c) },
        { label: "Align right", run: op((t) => setAlign(t, c, "right"), r, c) },
      ],
      [
        { label: "Sort A → Z", run: op((t) => sortRows(t, c, "asc"), r, c), disabled: rows < 3 },
        { label: "Sort Z → A", run: op((t) => sortRows(t, c, "desc"), r, c), disabled: rows < 3 },
      ],
      [{ label: "Delete table", run: () => this.deleteTable() }],
    ];

    const menu = document.createElement("div");
    menu.className = "cm-table-menu menu-panel";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Table");
    groups.forEach((g, i) => {
      if (i > 0) {
        const sep = document.createElement("div");
        sep.setAttribute("role", "separator");
        menu.append(sep);
      }
      for (const item of g) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = item.label;
        b.disabled = !!item.disabled;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => {
          this.closeMenu();
          item.run?.();
        });
        menu.append(b);
      }
    });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        this.closeMenu();
        this.focusCell(r, c, "end");
      }
    });
    document.body.append(menu);
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
    this.menu = menu;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    this.closeMenuListener = (e: Event) => {
      if (!menu.contains(e.target as Node)) this.closeMenu();
    };
    document.addEventListener("mousedown", this.closeMenuListener, true);
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
    if (this.closeMenuListener) document.removeEventListener("mousedown", this.closeMenuListener, true);
    this.closeMenuListener = null;
  }

  private deleteTable() {
    const view = this.view;
    const to = Math.min(view.state.doc.length, this.to + 1);
    this.focus = null;
    view.dispatch({ changes: { from: this.from, to }, selection: { anchor: this.from }, annotations: gridEdit.of(true) });
    view.focus();
  }
}

/** The grid widget that replaces a table's lines in live preview. */
export class TableWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.markdown === this.markdown && other.from === this.from;
  }
  toDOM(view: EditorView) {
    return new GridController(view, this.markdown, this.from).dom;
  }
  updateDOM(dom: HTMLElement) {
    const c = controllers.get(dom);
    if (!c) return false;
    c.update(this.markdown, this.from);
    return true;
  }
  destroy(dom: HTMLElement) {
    controllers.get(dom)?.destroy();
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return this.markdown.split("\n").length * 36;
  }
}

function gridAround(view: EditorView, pos: number): GridController | null {
  for (const c of registry.get(view) ?? []) if (pos >= c.from && pos <= c.to) return c;
  return null;
}

/** The grid with a focused cell, if any. */
function focusedGrid(view: EditorView): GridController | null {
  for (const c of registry.get(view) ?? []) if (c.hasFocus()) return c;
  return null;
}

/** For the formatting toolbar: wraps the selection in the cell being edited. False if no cell has focus. */
export function wrapInTableCell(view: EditorView, marker: string): boolean {
  return focusedGrid(view)?.wrapFocused(marker) ?? false;
}

/** The source range of the table whose cell is being edited, if any. */
export function focusedTableRange(view: EditorView): { from: number; to: number } | null {
  const g = focusedGrid(view);
  return g ? { from: g.from, to: g.to } : null;
}

/** Whether a table cell (not the editor itself) is being edited. */
export function editingTableCell(view: EditorView): boolean {
  return focusedGrid(view) !== null;
}

/**
 * Moving the cursor into a table (arrow keys, search, a new table) moves focus
 * into the matching cell; arrow keys on the lines next to a table enter it.
 */
export function tableGridExtensions() {
  return [
    typingText,
    EditorView.updateListener.of((u) => {
      if (!u.state.facet(tableGridOn)) return;
      const moved = u.transactions.some(
        (tr) =>
          tr.selection &&
          !tr.annotation(gridEdit) &&
          // Typing a table by hand stays in the text until Enter or Tab moves on.
          !["undo", "redo", "select.pointer", "input.type", "input.paste", "input.drop", "delete"].some((e) => tr.isUserEvent(e)),
      );
      const sel = u.state.selection.main;
      if (!moved || !sel.empty) return;
      const grid = gridAround(u.view, sel.head);
      if (grid) queueMicrotask(() => grid.focusAt(sel.head - grid.from));
    }),
    Prec.highest(
      keymap.of([
        {
          key: "ArrowDown",
          run: (view) => {
            if (!view.state.facet(tableGridOn) || completionStatus(view.state) === "active") return false;
            const sel = view.state.selection.main;
            const line = view.state.doc.lineAt(sel.head);
            if (!sel.empty || line.to >= view.state.doc.length) return false;
            const below = view.moveVertically(sel, true);
            if (below.head <= line.to) return false; // still on this line (wrapped)
            const grid = gridAround(view, line.to + 1);
            if (!grid || grid.from !== line.to + 1) return false;
            grid.focusCell(0, 0, "start");
            return true;
          },
        },
        {
          key: "ArrowUp",
          run: (view) => {
            if (!view.state.facet(tableGridOn) || completionStatus(view.state) === "active") return false;
            const sel = view.state.selection.main;
            const line = view.state.doc.lineAt(sel.head);
            if (!sel.empty || line.from === 0) return false;
            const above = view.moveVertically(sel, false);
            if (above.head >= line.from) return false;
            const grid = gridAround(view, line.from - 1);
            if (!grid || grid.to !== line.from - 1) return false;
            const rows = (parseTable(grid.source)?.rows.length ?? 1) - 1;
            grid.focusCell(rows, 0, "end");
            return true;
          },
        },
      ]),
    ),
  ];
}
