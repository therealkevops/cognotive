"use client";

import "@/lib/install"; // catch the browser's install offer as early as possible
import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { SyncProvider } from "@/components/sync/useSync";
import { VaultProvider } from "@/components/vault/useVault";
import { VaultsProvider, useVaults } from "@/components/vault/useVaults";
import { LocalStore } from "@/lib/vault/local-store";

// The workspace depends on browser-only APIs (IndexedDB, localStorage), so it
// renders on the client only.
const Workspace = dynamic(
  () => import("@/components/workspace/Workspace").then((m) => m.Workspace),
  {
    ssr: false,
    loading: () => <p className="p-8 text-muted">Loading…</p>,
  },
);

/** One vault's providers. Keyed by vault id, so switching vaults starts fresh. */
function ActiveVault() {
  const { active } = useVaults();
  const store = useMemo(() => new LocalStore(active.id), [active.id]);
  return (
    <VaultProvider vaultId={active.id} store={store} seed={active.kind === "local"}>
      {active.kind === "github" ? (
        <SyncProvider config={active} store={store}>
          <Workspace />
        </SyncProvider>
      ) : (
        <Workspace />
      )}
    </VaultProvider>
  );
}

function Vaults() {
  const { active } = useVaults();
  return <ActiveVault key={active.id} />;
}

const ClientOnlyVaults = dynamic(async () => Vaults, { ssr: false });

export function AppRoot() {
  // Offline support for the installed app (production builds only; dev reloads would fight a cache).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <VaultsProvider>
      <ClientOnlyVaults />
    </VaultsProvider>
  );
}
