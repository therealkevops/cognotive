import type { ReactNode } from "react";

/**
 * The three-pane layout every later phase fills in: vault sidebar on the left,
 * editor in the middle, and a context panel (backlinks, graph, chat) on the right.
 */
export function AppShell({
  sidebar,
  children,
  panel,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-1 md:grid-cols-[16rem_1fr] lg:grid-cols-[16rem_1fr_20rem]">
      <aside
        aria-label="Vault"
        className="hidden border-r border-border bg-surface p-4 md:block"
      >
        {sidebar}
      </aside>
      <main className="min-w-0 overflow-y-auto p-6">{children}</main>
      <aside
        aria-label="Context"
        className="hidden border-l border-border bg-surface p-4 lg:block"
      >
        {panel}
      </aside>
    </div>
  );
}
