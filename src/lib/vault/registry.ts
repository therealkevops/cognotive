import { readPref, writePref } from "../prefs";

export type SyncMode = "auto" | "manual";

interface VaultBase {
  id: string;
  name: string;
}

export interface LocalVaultConfig extends VaultBase {
  kind: "local";
}

export interface GitHubVaultConfig extends VaultBase {
  kind: "github";
  owner: string;
  repo: string;
  branch: string;
  /** Subfolder of the repo that holds the vault; "" for the whole repo. */
  folder: string;
  syncMode: SyncMode;
  /** Auto mode: commit this many seconds after the last edit. */
  idleSeconds: number;
}

export type VaultConfig = LocalVaultConfig | GitHubVaultConfig;

export const DEFAULT_VAULT: LocalVaultConfig = { id: "default", name: "My notes", kind: "local" };
export const DEFAULT_IDLE_SECONDS = 30;

/** The vault list lives in localStorage: it's per browser, like Obsidian's vault switcher. */
export function loadVaults(): VaultConfig[] {
  const vaults = readPref<VaultConfig[]>("vaults", []);
  return vaults.length ? vaults : [DEFAULT_VAULT];
}

export function saveVaults(vaults: VaultConfig[]): void {
  writePref("vaults", vaults);
}

export function loadActiveVaultId(vaults: VaultConfig[]): string {
  const id = readPref<string | null>("activeVault", null);
  return vaults.some((v) => v.id === id) ? id! : vaults[0].id;
}

export function saveActiveVaultId(id: string): void {
  writePref("activeVault", id);
}

export function newVaultId(kind: VaultConfig["kind"]): string {
  return `${kind === "github" ? "gh" : "local"}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Removes a vault's local data (working copy and sync state) from this browser. */
export async function deleteVaultData(id: string): Promise<void> {
  const del = (name: string) =>
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  await Promise.all([del(`noted-ai:vault:${id}`), del(`noted-ai:sync:${id}`)]);
  for (const key of ["last", "seeded", "expanded"]) writePref(`vault:${id}:${key}`, null);
}

export function describeVault(v: VaultConfig): string {
  if (v.kind === "local") return "Stored in this browser";
  return `${v.owner}/${v.repo}${v.folder ? `/${v.folder}` : ""} · ${v.branch}`;
}
