"use client";

import { useMemo } from "react";
import { extractHeadings } from "@/lib/markdown/outline";

/** Table of contents for the open note. Clicking a heading jumps to it. */
export function Outline({ markdown, onJump }: { markdown: string; onJump(offset: number): void }) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <section aria-label="Outline">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Outline</h2>
      {headings.length === 0 ? (
        <p className="text-sm text-muted">No headings in this note.</p>
      ) : (
        <ul className="-mx-2">
          {headings.map((h) => (
            <li key={h.offset}>
              <button
                type="button"
                className="w-full truncate rounded px-2 py-1 text-left text-sm text-foreground/85 hover:bg-foreground/5"
                style={{ paddingLeft: `${(h.level - min) * 0.85 + 0.5}rem` }}
                onClick={() => onJump(h.offset)}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
