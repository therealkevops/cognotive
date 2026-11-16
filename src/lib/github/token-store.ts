import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Personal access tokens for repositories connected with a token, one per
 * repository, kept in this browser only.
 */
export interface StoredToken {
  token: string;
  /** The GitHub account the token belongs to. */
  login: string;
  /** When GitHub will stop accepting it; null if it never expires. */
  expiresAt: number | null;
}

interface TokenDB extends DBSchema {
  tokens: { key: string; value: StoredToken };
}

let db_: Promise<IDBPDatabase<TokenDB>> | null = null;
const db = () =>
  (db_ ??= openDB<TokenDB>("noted-ai:tokens", 1, {
    upgrade(d) {
      d.createObjectStore("tokens");
    },
  }));

export async function loadToken(vaultId: string): Promise<StoredToken | undefined> {
  return (await db()).get("tokens", vaultId);
}

export async function saveToken(vaultId: string, t: StoredToken): Promise<void> {
  await (await db()).put("tokens", t, vaultId);
}

export async function forgetToken(vaultId: string): Promise<void> {
  await (await db()).delete("tokens", vaultId);
}

/** Where to create a token: GitHub's fine-grained token page. */
export const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

/** Days left before `expiresAt`, rounded down; null if it doesn't expire. */
export function daysLeft(expiresAt: number | null, now = Date.now()): number | null {
  return expiresAt === null ? null : Math.floor((expiresAt - now) / 86_400_000);
}
