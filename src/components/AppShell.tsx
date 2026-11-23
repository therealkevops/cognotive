"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DEFAULT_WIDTHS, MAX_WIDTH, MIN_WIDTH, clampWidth, loadWidths, saveWidths, type SidebarWidths } from "@/lib/sidebar-widths";
import { ErrorBoundary } from "./ErrorBoundary";

/** Width of a collapsed sidebar: a rail of icons. */
const RAIL = "3.25rem";
const RAIL_PX = 52;

/**
 * Each column starts with a header row of the same height (48px), so the repository name, the
 * file name and the panel tabs line up across the window, and the collapsed rails' first icons
 * sit on the same line.
 *
 * The three-pane layout: repository sidebar on the left, editor in the middle, and a
 * context panel on the right. Either side can collapse to a slim rail of icons
 * (from md / lg up). Below md the sidebar is an overlay opened from the header.
 * Open sides can be resized by dragging their inner edge (kept on this device).
 */
export function AppShell({
  sidebar,
  children,
  panel,
  sidebarOpen = false,
  onCloseSidebar,
  leftCollapsed = false,
  rightCollapsed = false,
  leftRail,
  rightRail,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  panel: ReactNode;
  sidebarOpen?: boolean;
  onCloseSidebar?: () => void;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  /** Icons shown instead of the sidebar while it's collapsed. */
  leftRail?: ReactNode;
  /** Icons shown instead of the context panel while it's collapsed. */
  rightRail?: ReactNode;
}) {
  // As dragged last time (kept in this browser); the workspace renders only in the browser.
  const [widths, setWidths] = useState<SidebarWidths>(loadWidths);
  const [resizing, setResizing] = useState(false);

  const columns = {
    "--left": leftCollapsed ? RAIL : `${widths.left}px`,
    "--right": rightCollapsed ? RAIL : `${widths.right}px`,
  } as CSSProperties;
  const resize = (side: keyof SidebarWidths, width: number, save: boolean) =>
    setWidths((w) => {
      const other = side === "left" ? (rightCollapsed ? RAIL_PX : w.right) : leftCollapsed ? RAIL_PX : w.left;
      const next = { ...w, [side]: clampWidth(width, other, window.innerWidth) };
      if (save) saveWidths(next);
      return next;
    });
  return (
    <div
      className={`relative grid h-dvh grid-cols-1 md:grid-cols-[var(--left)_1fr] lg:grid-cols-[var(--left)_1fr_var(--right)] ${
        resizing ? "" : "transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none"
      }`}
      style={columns}
    >
      {!leftCollapsed && (
        <ResizeHandle side="left" label="Resize the sidebar" width={widths.left} onResize={resize} onDragging={setResizing} />
      )}
      {!rightCollapsed && (
        <ResizeHandle side="right" label="Resize the side panel" width={widths.right} onResize={resize} onDragging={setResizing} />
      )}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onCloseSidebar} aria-hidden />
      )}
      <aside
        aria-label="Repository"
        className={`${
          sidebarOpen ? "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shadow-xl" : "hidden"
        } min-h-0 min-w-0 flex-col border-r border-border bg-sidebar px-2.5 pb-3 md:static md:z-auto md:w-auto md:max-w-none md:shadow-none ${
          leftCollapsed ? "md:hidden" : "md:flex"
        }`}
      >
        <ErrorBoundary name="The sidebar">{sidebar}</ErrorBoundary>
      </aside>
      {leftCollapsed && (
        <nav
          aria-label="Repository rail"
          className="hidden min-h-0 flex-col items-center gap-1 border-r border-border bg-sidebar pt-1.5 pb-3 md:flex"
        >
          {leftRail}
        </nav>
      )}
      <main className="flex min-h-0 min-w-0 flex-col">
        <ErrorBoundary name="The workspace">{children}</ErrorBoundary>
      </main>
      {rightCollapsed ? (
        <nav
          aria-label="Context rail"
          className="hidden min-h-0 flex-col items-center gap-1 border-l border-border bg-background pt-1.5 pb-3 lg:flex"
        >
          {rightRail}
        </nav>
      ) : (
        <aside
          aria-label="Context"
          className="hidden min-h-0 min-w-0 overflow-y-auto border-l border-border bg-background px-4 pb-3 lg:block"
        >
          <ErrorBoundary name="The side panel">{panel}</ErrorBoundary>
        </aside>
      )}
    </div>
  );
}

/** A button on a rail: an icon with its name as a tooltip. */
export function RailButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick(): void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-button h-9 w-9 ${active ? "bg-foreground/[0.08] text-foreground" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * The draggable edge between a side and the middle: drag it, or focus it and use the arrow
 * keys (Shift for bigger steps); a double-click puts the default width back.
 */
function ResizeHandle({
  side,
  label,
  width,
  onResize,
  onDragging,
}: {
  side: keyof SidebarWidths;
  label: string;
  width: number;
  onResize(side: keyof SidebarWidths, width: number, save: boolean): void;
  onDragging(on: boolean): void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const sign = side === "left" ? 1 : -1;
  const at = (e: PointerEvent) => drag.current!.width + sign * (e.clientX - drag.current!.x);

  const end = (e: PointerEvent) => {
    if (!drag.current) return;
    onResize(side, at(e), true);
    drag.current = null;
    setActive(false);
    onDragging(false);
    document.body.classList.remove("is-resizing");
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) onResize(side, width + step, true);
    else if (e.key === shrink) onResize(side, width - step, true);
    else if (e.key === "Home") onResize(side, MIN_WIDTH, true);
    else if (e.key === "End") onResize(side, MAX_WIDTH, true);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize; double-click for the default width"
      data-active={active || undefined}
      className={`resize-handle absolute inset-y-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none ${
        side === "left" ? "md:block" : "lg:block"
      }`}
      style={side === "left" ? { left: "var(--left)" } : { left: "calc(100% - var(--right))" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
        setActive(true);
        onDragging(true);
        document.body.classList.add("is-resizing");
      }}
      onPointerMove={(e) => drag.current && onResize(side, at(e), false)}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(side, DEFAULT_WIDTHS[side], true)}
      onKeyDown={onKey}
    />
  );
}
