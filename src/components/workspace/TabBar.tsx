"use client";

import { FileText, Image as ImageIcon, PenTool, X } from "lucide-react";
import { basename, drawingName, extname, isDrawing, isImage, isMarkdown } from "@/lib/vault/paths";

function label(path: string) {
  const name = basename(path);
  const ext = extname(name);
  if (isDrawing(path)) return drawingName(path);
  return isMarkdown(path) ? name.slice(0, -ext.length) : name;
}

/** Open notes as tabs. Middle-click or × closes one. */
export function TabBar({
  tabs,
  active,
  onSelect,
  onClose,
}: {
  tabs: string[];
  active: string | null;
  onSelect(path: string): void;
  onClose(path: string): void;
}) {
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" aria-label="Open notes" className="flex gap-0.5 overflow-x-auto border-b border-border bg-surface px-2 pt-1">
      {tabs.map((path) => {
        const Icon = isDrawing(path) ? PenTool : isImage(path) ? ImageIcon : FileText;
        const selected = path === active;
        return (
          // The tab and its close button are siblings: a role="tab" element can't contain other controls.
          <div
            key={path}
            title={path}
            className={`group flex max-w-48 shrink-0 items-center rounded-t-md border border-b-0 pr-1 text-sm ${
              selected ? "border-border bg-background" : "border-transparent text-muted hover:text-foreground"
            }`}
            onAuxClick={(e) => e.button === 1 && onClose(path)}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              className="flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1"
              onClick={() => onSelect(path)}
            >
              <Icon size={13} aria-hidden className="shrink-0" />
              <span className="truncate">{label(path)}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${label(path)}`}
              className={`icon-button h-5 w-5 ${selected ? "" : "invisible group-hover:visible"}`}
              onClick={() => onClose(path)}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
