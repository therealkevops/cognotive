import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Head } from "./remote";

/** What the vault looked like at the last successful sync. */
export interface SyncSnapshot {
  head: Head | null;
  /** Local vault path → git blob sha, for every synced file. */
  base: Record<string, string>;
  syncedAt: number | null;
  /**
   * Remembered so a sync needn't re-read everything (both optional: older snapshots lack them).
   * `hashes`: each local file's id at a modification time; `scheme`: the id of empty content,
   * so the hashes are dropped if the remote names content differently (say, encryption).
   */
  hashes?: Record<string, { mtime: number; sha: string }>;
  scheme?: string;
  /** The remote's syncable files (vault path → id) at one tree, reused while the branch stays there. */
  remoteTree?: { tree: string; files: Record<string, string> };
}

interface SyncDB extends DBSchema {
  kv: { key: string; value: SyncSnapshot };
}

const EMPTY: SyncSnapshot = { head: null, base: {}, syncedAt: null };

export interface SyncStateStore {
  load(): Promise<SyncSnapshot>;
  save(s: SyncSnapshot): Promise<void>;
}

export class IdbSyncState implements SyncStateStore {
  private db_: Promise<IDBPDatabase<SyncDB>> | null = null;
  constructor(readonly vaultId: string) {}

  private get db() {
    this.db_ ??= openDB<SyncDB>(`noted-ai:sync:${this.vaultId}`, 1, {
      upgrade(db) {
        db.createObjectStore("kv");
      },
    });
    return this.db_;
  }

  async load(): Promise<SyncSnapshot> {
    return (await (await this.db).get("kv", "snapshot")) ?? EMPTY;
  }

  async save(s: SyncSnapshot): Promise<void> {
    await (await this.db).put("kv", s, "snapshot");
  }
}

export class MemorySyncState implements SyncStateStore {
  snapshot: SyncSnapshot = EMPTY;
  async load() {
    return this.snapshot;
  }
  async save(s: SyncSnapshot) {
    this.snapshot = s;
  }
}
