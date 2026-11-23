import type { CSSProperties, ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

/** Width of a collapsed sidebar: a rail of icons. */
const RAIL = "3.25rem";

/**
 * Each column starts with a header row of the same height (HEADER, 48px) with a divider under it,
 * so the repository name, the file name and the panel tabs line up across the window, and the
 * collapsed rails' first icons sit on the same line.
 *
 * The three-pane layout: repository sidebar on the left, editor in the middle, and a
 * context panel on the right. Either side can collapse to a slim rail of icons
 * (from md / lg up). Below md the sidebar is an overlay opened from the header.
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
  const columns = {
    "--left": leftCollapsed ? RAIL : "17rem",
    "--right": rightCollapsed ? RAIL : "18rem",
  } as CSSProperties;
  return (
    <div
      className="grid h-dvh grid-cols-1 transition-[grid-template-columns] duration-200 ease-out md:grid-cols-[var(--left)_1fr] lg:grid-cols-[var(--left)_1fr_var(--right)] motion-reduce:transition-none"
      style={columns}
    >
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
