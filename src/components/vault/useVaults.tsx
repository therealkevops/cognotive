"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  deleteVaultData,
  loadActiveVaultId,
  loadVaults,
  saveActiveVaultId,
  saveVaults,
  type VaultConfig,
} from "@/lib/vault/registry";

interface VaultsApi {
  vaults: VaultConfig[];
  active: VaultConfig;
  switchTo(id: string): void;
  add(v: VaultConfig, open?: boolean): void;
  update(id: string, patch: Partial<VaultConfig>): void;
  /** Forgets a vault and deletes its copy in this browser. Its GitHub repo is untouched. */
  remove(id: string): Promise<void>;
}

const VaultsContext = createContext<VaultsApi | null>(null);

export function useVaults(): VaultsApi {
  const v = useContext(VaultsContext);
  if (!v) throw new Error("useVaults must be used inside <VaultsProvider>");
  return v;
}

export function VaultsProvider({ children }: { children: ReactNode }) {
  const [vaults, setVaults] = useState<VaultConfig[]>(loadVaults);
  const [activeId, setActiveId] = useState(() => loadActiveVaultId(loadVaults()));

  const commit = useCallback((next: VaultConfig[]) => {
    setVaults(next);
    saveVaults(next);
  }, []);

  const switchTo = useCallback((id: string) => {
    setActiveId(id);
    saveActiveVaultId(id);
  }, []);

  const api = useMemo<VaultsApi>(() => {
    const active = vaults.find((v) => v.id === activeId) ?? vaults[0];
    return {
      vaults,
      active,
      switchTo,
      add(v, open = true) {
        commit([...vaults, v]);
        if (open) switchTo(v.id);
      },
      update(id, patch) {
        commit(vaults.map((v) => (v.id === id ? ({ ...v, ...patch } as VaultConfig) : v)));
      },
      async remove(id) {
        const rest = vaults.filter((v) => v.id !== id);
        if (rest.length === 0) throw new Error("Keep at least one vault.");
        if (active.id === id) switchTo(rest[0].id);
        commit(rest);
        await deleteVaultData(id);
      },
    };
  }, [vaults, activeId, commit, switchTo]);

  return <VaultsContext.Provider value={api}>{children}</VaultsContext.Provider>;
}
