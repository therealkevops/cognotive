import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { RepoKeys } from "./repo-crypto";

/**
 * Each device keeps an encrypted repository's working keys in IndexedDB, as
 * non-extractable CryptoKeys: usable here, but they can't be read back out.
 */
interface KeyDB extends DBSchema {
  keys: { key: string; value: RepoKeys };
}

let db_: Promise<IDBPDatabase<KeyDB>> | null = null;
const db = () =>
  (db_ ??= openDB<KeyDB>("noted-ai:keys", 1, {
    upgrade(d) {
      d.createObjectStore("keys");
    },
  }));

export async function loadKeys(vaultId: string): Promise<RepoKeys | undefined> {
  return (await db()).get("keys", vaultId);
}

export async function saveKeys(vaultId: string, keys: RepoKeys): Promise<void> {
  await (await db()).put("keys", keys, vaultId);
}

export async function forgetKeys(vaultId: string): Promise<void> {
  await (await db()).delete("keys", vaultId);
}
