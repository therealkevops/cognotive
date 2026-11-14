import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { isWithin, joinPath, normalizePath } from "./paths";
import type { VaultEntry, VaultFile, VaultStore } from "./types";

interface VaultDB extends DBSchema {
  files: { key: string; value: VaultFile };
  folders: { key: string; value: { path: string; mtime: number } };
}

/** A vault kept entirely in this browser's IndexedDB. One database per vault. */
export class LocalStore implements VaultStore {
  private db_: Promise<IDBPDatabase<VaultDB>> | null = null;

  constructor(
    readonly vaultId: string,
    private now: () => number = Date.now,
  ) {}

  /** Opened on first use, so constructing a store is safe during server rendering. */
  private get db(): Promise<IDBPDatabase<VaultDB>> {
    this.db_ ??= openDB<VaultDB>(`noted-ai:vault:${this.vaultId}`, 1, {
      upgrade(db) {
        db.createObjectStore("files", { keyPath: "path" });
        db.createObjectStore("folders", { keyPath: "path" });
      },
    });
    return this.db_;
  }

  async list(): Promise<VaultEntry[]> {
    const db = await this.db;
    const [files, folders] = await Promise.all([db.getAll("files"), db.getAll("folders")]);
    return [
      ...folders.map((f) => ({ path: f.path, kind: "folder" as const, mtime: f.mtime })),
      ...files.map((f) => ({ path: f.path, kind: "file" as const, mtime: f.mtime })),
    ];
  }

  async read(path: string): Promise<VaultFile | undefined> {
    return (await this.db).get("files", normalizePath(path));
  }

  async write(path: string, content: string): Promise<VaultFile> {
    const file = { path: normalizePath(path), content, mtime: this.now() };
    if (!file.path) throw new Error("A file needs a name.");
    await (await this.db).put("files", file);
    return file;
  }

  /**
   * Compare-and-set for sync: writes `content` (or deletes, if null) only if the
   * file still holds `expected` (undefined = must not exist). Returns false, and
   * changes nothing, if the user edited the file in the meantime.
   */
  async writeIf(path: string, expected: string | undefined, content: string | null): Promise<boolean> {
    const p = normalizePath(path);
    const db = await this.db;
    const tx = db.transaction("files", "readwrite");
    const current = await tx.store.get(p);
    if (current?.content !== expected) {
      await tx.done;
      return false;
    }
    if (content === null) await tx.store.delete(p);
    else await tx.store.put({ path: p, content, mtime: this.now() });
    await tx.done;
    return true;
  }

  async createFolder(path: string): Promise<void> {
    const p = normalizePath(path);
    if (!p) return;
    await (await this.db).put("folders", { path: p, mtime: this.now() });
  }

  async delete(path: string): Promise<void> {
    const p = normalizePath(path);
    const db = await this.db;
    const tx = db.transaction(["files", "folders"], "readwrite");
    for (const name of ["files", "folders"] as const) {
      const store = tx.objectStore(name);
      for (const key of await store.getAllKeys()) {
        if (isWithin(key, p)) await store.delete(key);
      }
    }
    await tx.done;
  }

  async rename(from: string, to: string): Promise<void> {
    const src = normalizePath(from);
    const dst = normalizePath(to);
    if (!src || !dst) throw new Error("Both paths need a name.");
    if (src === dst) return;
    if (isWithin(dst, src)) throw new Error("Can't move a folder into itself.");
    const db = await this.db;
    const tx = db.transaction(["files", "folders"], "readwrite");
    const files = tx.objectStore("files");
    const folders = tx.objectStore("folders");
    if ((await files.get(dst)) || (await folders.get(dst))) {
      tx.done.catch(() => {});
      tx.abort();
      throw new Error(`"${dst}" already exists.`);
    }
    const moved = (key: string) => joinPath(dst, key.slice(src.length));
    const now = this.now();
    for (const file of await files.getAll()) {
      if (!isWithin(file.path, src)) continue;
      await files.delete(file.path);
      await files.put({ ...file, path: moved(file.path), mtime: now });
    }
    for (const folder of await folders.getAll()) {
      if (!isWithin(folder.path, src)) continue;
      await folders.delete(folder.path);
      await folders.put({ path: moved(folder.path), mtime: now });
    }
    await tx.done;
  }

  async close(): Promise<void> {
    if (this.db_) (await this.db_).close();
    this.db_ = null;
  }
}
