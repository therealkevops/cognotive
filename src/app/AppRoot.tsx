"use client";

import dynamic from "next/dynamic";
import { VaultProvider } from "@/components/vault/useVault";

// The workspace depends on browser-only APIs (IndexedDB, localStorage), so it
// renders on the client only. Phase 2 replaces the fixed vault with a vault switcher.
const Workspace = dynamic(
  () => import("@/components/workspace/Workspace").then((m) => m.Workspace),
  {
    ssr: false,
    loading: () => <p className="p-8 text-muted">Loading…</p>,
  },
);

export function AppRoot() {
  return (
    <VaultProvider vaultId="default">
      <Workspace />
    </VaultProvider>
  );
}
