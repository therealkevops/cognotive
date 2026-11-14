"use client";

import type { EditorView } from "@codemirror/view";
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
  insertTable,
  setHeading,
  toggleBold,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleLinePrefix,
  toggleStrikethrough,
  type Command,
} from "@/lib/editor/formatting";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (keys: string) => keys.replace("Mod", isMac ? "⌘" : "Ctrl").replace("Alt", isMac ? "⌥" : "Alt");

type Item = { label: string; icon: LucideIcon; run: Command; keys?: string } | "sep";

const ITEMS: Item[] = [
  { label: "Heading 1", icon: Heading1, run: setHeading(1), keys: "Mod+Alt+1" },
  { label: "Heading 2", icon: Heading2, run: setHeading(2), keys: "Mod+Alt+2" },
  { label: "Heading 3", icon: Heading3, run: setHeading(3), keys: "Mod+Alt+3" },
  "sep",
  { label: "Bold", icon: Bold, run: toggleBold, keys: "Mod+B" },
  { label: "Italic", icon: Italic, run: toggleItalic, keys: "Mod+I" },
  { label: "Strikethrough", icon: Strikethrough, run: toggleStrikethrough, keys: "Mod+Shift+X" },
  { label: "Highlight", icon: Highlighter, run: toggleHighlight, keys: "Mod+Shift+H" },
  { label: "Inline code", icon: Code, run: toggleInlineCode, keys: "Mod+`" },
  { label: "Link", icon: Link, run: insertLink, keys: "Mod+K" },
  "sep",
  { label: "Bulleted list", icon: List, run: toggleLinePrefix("bullet"), keys: "Mod+Shift+8" },
  { label: "Numbered list", icon: ListOrdered, run: toggleLinePrefix("ordered"), keys: "Mod+Shift+7" },
  { label: "Task list", icon: ListTodo, run: toggleLinePrefix("task"), keys: "Mod+Shift+9" },
  { label: "Quote", icon: TextQuote, run: toggleLinePrefix("quote") },
  "sep",
  { label: "Code block", icon: SquareCode, run: insertCodeBlock },
  { label: "Table", icon: Table, run: insertTable },
  { label: "Divider", icon: Minus, run: insertHorizontalRule },
];

export function Toolbar({ view }: { view: EditorView | null }) {
  return (
    <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
      {ITEMS.map((item, i) =>
        item === "sep" ? (
          <span key={i} className="mx-1 h-5 w-px bg-border" aria-hidden />
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
