"use client";

import { FilePlus, FileText } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { basename, dirname, displayName, isCanvas, isDrawing, isMarkdown, validateName } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

interface Option {
  key: string;
  title: string;
  folder: string;
  create?: boolean;
}

/** Ctrl/Cmd+O: jump to a note by name, or create it if it doesn't exist. */
export function QuickSwitcher({ onClose, onOpenSide }: { onClose(): void; onOpenSide?(path: string): void }) {
  const vault = useVault();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo<Option[]>(() => {
    const q = query.trim();
    let found: Option[];
    if (!q) {
      // Most recently modified first.
      found = vault.entries
        .filter((e) => e.kind === "file" && !e.path.split("/").some((seg) => seg.startsWith(".")))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)
        .map((e) => ({ key: e.path, title: isMarkdown(e.path) || isCanvas(e.path) || isDrawing(e.path) ? displayName(e.path) : basename(e.path), folder: dirname(e.path) }));
    } else {
      found = vault.index
        .searchTitles(q)
        .map((h) => ({ key: h.path, title: h.title, folder: dirname(h.path) }));
    }
    const exact = found.some((o) => o.title.toLowerCase() === q.toLowerCase());
    if (q && !exact && !validateName(q)) {
      found.push({ key: `create:${q}`, title: q, folder: "", create: true });
    }
    return found;
    // indexVersion: recompute when notes change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, vault.entries, vault.index, vault.indexVersion]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  /** Shift+Enter opens the note in the side pane instead. */
  const choose = async (o: Option | undefined, side = false) => {
    if (!o) return;
    onClose();
    if (o.create) await vault.createNote("", o.title);
    else if (side && onOpenSide) onOpenSide(o.key);
    else await vault.open(o.key);
  };

  return (
    <div
      className="dialog-backdrop pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        className="dialog-panel max-w-xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={options[selected] ? `${listId}-${selected}` : undefined}
          aria-label="Find or create a note"
          placeholder="Find or create a note…"
          className="w-full border-b border-border bg-transparent px-5 py-4 text-base outline-none placeholder:text-muted"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void choose(options[selected], e.shiftKey);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul ref={listRef} id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {options.length === 0 && <li className="px-4 py-2 text-sm text-muted">No notes found.</li>}
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              data-index={i}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                i === selected ? "bg-foreground/[0.07]" : ""
              }`}
              onMouseMove={() => setSelected(i)}
              onClick={() => void choose(o)}
            >
              {o.create ? (
                <FilePlus size={15} className="shrink-0 text-accent" aria-hidden />
              ) : (
                <FileText size={15} className="shrink-0 text-muted" aria-hidden />
              )}
              <span className="truncate">{o.create ? `Create “${o.title}”` : o.title}</span>
              {o.folder && <span className="ml-auto truncate text-xs text-muted">{o.folder}</span>}
            </li>
          ))}
        </ul>
        <div className="flex gap-4 border-t border-border px-5 py-2.5 text-xs text-muted">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          {onOpenSide && <span>⇧↵ side pane</span>}
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
