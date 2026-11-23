"use client";

import { FileText, Image as ImageIcon, LayoutDashboard, PenTool, X, XSquare } from "lucide-react";
import { basename, canvasName, drawingName, extname, isCanvas, isDrawing, isImage, isMarkdown } from "@/lib/vault/paths";

function label(path: string) {
  const name = basename(path);
  const ext = extname(name);
  if (isDrawing(path)) return drawingName(path);
  if (isCanvas(path)) return canvasName(path);
  return isMarkdown(path) ? name.slice(0, -ext.length) : name;
}

/** Open notes as tabs. Middle-click or × closes one; the button at the end closes them all. */
export function TabBar({
  tabs,
  active,
  onSelect,
  onClose,
  onCloseAll,
}: {
  tabs: string[];
  active: string | null;
  onSelect(path: string): void;
  onClose(path: string): void;
  onCloseAll(): void;
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="flex items-center border-b border-border pr-2">
    <div role="tablist" aria-label="Open notes" className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-3 pt-1.5 pb-1">
      {tabs.map((path) => {
        const Icon = isDrawing(path) ? PenTool : isCanvas(path) ? LayoutDashboard : isImage(path) ? ImageIcon : FileText;
        const selected = path === active;
        return (
          // The tab and its close button are siblings: a role="tab" element can't contain other controls.
          <div
            key={path}
            title={path}
            className={`group flex max-w-52 shrink-0 items-center rounded-lg pr-1 text-sm transition-colors ${
              selected
                ? "bg-raised text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)]"
                : "text-muted hover:bg-foreground/[0.05] hover:text-foreground"
            }`}
            onAuxClick={(e) => e.button === 1 && onClose(path)}
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              className="flex min-w-0 items-center gap-1.5 py-1.5 pl-2.5 pr-1"
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
      <button
        type="button"
        aria-label="Close all tabs"
        title="Close all tabs"
        className="icon-button h-7 w-7 shrink-0"
        onClick={onCloseAll}
      >
        <XSquare size={15} aria-hidden />
      </button>
    </div>
  );
}
