"use client";

import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import {
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  insertTableOf,
  setHeading,
  toggleBold,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleLinePrefix,
  toggleStrikethrough,
  type Command,
} from "@/lib/editor/formatting";
import { editingTableCell, wrapInTableCell } from "@/lib/editor/table-grid";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (keys: string) => keys.replace("Mod", isMac ? "⌘" : "Ctrl").replace("Alt", isMac ? "⌥" : "Alt");

/** `wrap`: the marker it puts around text, so it also works inside a table cell being edited. */
type Item = { label: string; icon: LucideIcon; run: Command; keys?: string; wrap?: string } | "table" | "sep";

const ITEMS: Item[] = [
  { label: "Heading 1", icon: Heading1, run: setHeading(1), keys: "Mod+Alt+1" },
  { label: "Heading 2", icon: Heading2, run: setHeading(2), keys: "Mod+Alt+2" },
  { label: "Heading 3", icon: Heading3, run: setHeading(3), keys: "Mod+Alt+3" },
  "sep",
  { label: "Bold", icon: Bold, run: toggleBold, keys: "Mod+B", wrap: "**" },
  { label: "Italic", icon: Italic, run: toggleItalic, keys: "Mod+I", wrap: "*" },
  { label: "Strikethrough", icon: Strikethrough, run: toggleStrikethrough, keys: "Mod+Shift+X", wrap: "~~" },
  { label: "Highlight", icon: Highlighter, run: toggleHighlight, keys: "Mod+Shift+H", wrap: "==" },
  { label: "Inline code", icon: Code, run: toggleInlineCode, keys: "Mod+`", wrap: "`" },
  { label: "Link", icon: Link, run: insertLink, keys: "Mod+K" },
  "sep",
  { label: "Bulleted list", icon: List, run: toggleLinePrefix("bullet"), keys: "Mod+Shift+8" },
  { label: "Numbered list", icon: ListOrdered, run: toggleLinePrefix("ordered"), keys: "Mod+Shift+7" },
  { label: "Task list", icon: ListTodo, run: toggleLinePrefix("task"), keys: "Mod+Shift+9" },
  { label: "Quote", icon: TextQuote, run: toggleLinePrefix("quote") },
  "sep",
  { label: "Code block", icon: SquareCode, run: insertCodeBlock },
  "table",
  { label: "Divider", icon: Minus, run: insertHorizontalRule },
];

export function Toolbar({ view }: { view: EditorView | null }) {
  return (
    // One scrollable row on phones instead of wrapping onto several lines.
    <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 overflow-x-auto sm:flex-wrap">
      {ITEMS.map((item, i) =>
        item === "sep" ? (
          <span key={i} className="mx-1 h-5 w-px bg-border" aria-hidden />
        ) : item === "table" ? (
          <TablePicker key="table" view={view} />
        ) : (
          <button
            key={item.label}
            type="button"
            className="icon-button"
            aria-label={item.label}
            title={item.keys ? `${item.label} (${mod(item.keys)})` : item.label}
            disabled={!view}
            // Keep focus (and the selection) in the editor.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!view) return;
              // In a table cell only inline formatting applies, to the cell.
              if (editingTableCell(view)) {
                if (item.wrap) wrapInTableCell(view, item.wrap);
                return;
              }
              item.run(view);
              view.focus();
            }}
          >
            <item.icon size={16} aria-hidden />
          </button>
        ),
      )}
    </div>
  );
}

const PICK = 8;

/** The table button: pick a size (columns × rows) from a grid, or press Enter for 2 × 2. */
function TablePicker({ view }: { view: EditorView | null }) {
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState({ cols: 2, rows: 2 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const close = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const insert = (cols: number, rows: number) => {
    setOpen(null);
    if (!view) return;
    insertTableOf(rows, cols)(view);
    view.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label="Table"
        title="Table"
        aria-haspopup="dialog"
        aria-expanded={!!open}
        disabled={!view}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!view || editingTableCell(view)) return;
          if (open) return setOpen(null);
          const r = button.current!.getBoundingClientRect();
          setSize({ cols: 2, rows: 2 });
          setOpen({ left: Math.min(r.left, window.innerWidth - 230), top: r.bottom + 6 });
        }}
      >
        <Table size={16} aria-hidden />
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Insert table"
          tabIndex={-1}
          className="menu-panel fixed z-40 p-2 outline-none"
          style={{ left: open.left, top: open.top }}
          onKeyDown={(e) => {
            const move = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
            if (move) {
              e.preventDefault();
              setSize((s) => ({
                cols: Math.max(1, Math.min(PICK, s.cols + move[0])),
                rows: Math.max(1, Math.min(PICK, s.rows + move[1])),
              }));
            } else if (e.key === "Enter") {
              e.preventDefault();
              insert(size.cols, size.rows);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setOpen(null);
              view?.focus();
            }
          }}
        >
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${PICK}, 1.25rem)` }}>
            {Array.from({ length: PICK * PICK }, (_, i) => {
              const cols = (i % PICK) + 1;
              const rows = Math.floor(i / PICK) + 1;
              const on = cols <= size.cols && rows <= size.rows;
              return (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${cols} × ${rows} table`}
                  className={`h-5 w-5 rounded-[4px] border ${on ? "border-accent bg-accent/25" : "border-border bg-surface"}`}
                  onMouseEnter={() => setSize({ cols, rows })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(cols, rows)}
                />
              );
            })}
          </div>
          <p className="mt-2 text-center text-xs text-muted" aria-live="polite">
            {size.cols} columns × {size.rows} rows
          </p>
        </div>
      )}
    </>
  );
}
