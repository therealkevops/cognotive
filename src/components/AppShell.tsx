import type { ReactNode } from "react";

/**
 * The three-pane layout: vault sidebar on the left, editor in the middle, and a
 * context panel (outline now; backlinks, graph and chat later) on the right.
 * Below the md breakpoint the sidebar becomes an overlay opened from the header.
 */
export function AppShell({
  sidebar,
  children,
  panel,
  sidebarOpen = false,
  onCloseSidebar,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  panel: ReactNode;
  sidebarOpen?: boolean;
  onCloseSidebar?: () => void;
}) {
  return (
    <div className="grid h-dvh grid-cols-1 md:grid-cols-[16rem_1fr] lg:grid-cols-[16rem_1fr_18rem]">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onCloseSidebar} aria-hidden />
      )}
      <aside
        aria-label="Vault"
        className={`${
          sidebarOpen ? "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shadow-xl" : "hidden"
        } min-h-0 flex-col border-r border-border bg-surface p-3 md:static md:z-auto md:flex md:w-auto md:max-w-none md:shadow-none`}
      >
        {sidebar}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col">{children}</main>
      <aside
        aria-label="Context"
        className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface p-4 lg:block"
      >
        {panel}
      </aside>
    </div>
  );
}
