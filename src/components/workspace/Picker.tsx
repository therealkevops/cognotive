"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface PickerItem {
  id: string;
  label: string;
  /** Shown on the right, e.g. a shortcut or folder. */
  hint?: string;
}

/** Matches when every word of the query appears in the label, in any order. */
export function matches(label: string, query: string): boolean {
  const l = label.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => l.includes(w));
}

/** A keyboard-driven list with a filter box: the command palette and the template chooser. */
export function Picker({
  title,
  placeholder,
  items,
  onPick,
  onClose,
  empty = "Nothing matches.",
  footer,
}: {
  title: string;
  placeholder: string;
  items: PickerItem[];
  onPick(item: PickerItem): void;
  onClose(): void;
  empty?: string;
  /** Options shown under the list (a checkbox, say). */
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => items.filter((i) => matches(i.label, query)), [items, query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (i: PickerItem | undefined) => {
    if (!i) return;
    onClose();
    onPick(i);
  };

  return (
    <div className="dialog-backdrop pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dialog-panel max-w-xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[selected] ? `${listId}-${selected}` : undefined}
          aria-label={placeholder}
          placeholder={placeholder}
          className="w-full border-b border-border bg-transparent px-5 py-4 text-base outline-none placeholder:text-muted"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(shown[selected]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul ref={listRef} id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted">{empty}</li>}
          {shown.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              data-index={i}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${i === selected ? "bg-foreground/[0.07]" : ""}`}
              onMouseMove={() => setSelected(i)}
              onClick={() => pick(item)}
            >
              <span className="truncate">{item.label}</span>
              {item.hint && <span className="ml-auto shrink-0 text-xs text-muted">{item.hint}</span>}
            </li>
          ))}
        </ul>
        {footer && <div className="border-t border-border px-5 py-3 text-sm">{footer}</div>}
      </div>
    </div>
  );
}
