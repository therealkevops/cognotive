import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { isWithin, joinPath, normalizePath } from "./paths";
import type { VaultEntry, VaultFile, VaultStore } from "./types";

interface BinaryRecord {
  path: string;
  /** Stored as an ArrayBuffer: structured-clonable everywhere, unlike Blob in some engines. */
  bytes: ArrayBuffer;
  mtime: number;
}

interface EntryRecord {
  path: string;
  mtime: number;
}

interface VaultDB extends DBSchema {
  files: { key: string; value: VaultFile };
  folders: { key: string; value: { path: string; mtime: number } };
  blobs: { key: string; value: BinaryRecord };
  /**
   * Every file's path and modification time (notes and attachments), kept next to the
   * contents in the same transactions, so listing the vault doesn't read any contents.
   */
  entries: { key: string; value: EntryRecord };
}

const STORES = ["files", "folders", "blobs", "entries"] as const;
const DB_VERSION = 3;

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
    this.db_ ??= openDB<VaultDB>(`noted-ai:vault:${this.vaultId}`, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          db.createObjectStore("files", { keyPath: "path" });
          db.createObjectStore("folders", { keyPath: "path" });
        }
        if (oldVersion < 2) db.createObjectStore("blobs", { keyPath: "path" });
        if (oldVersion < 3) {
          // Fill the entries store from what's already here (read once, this time only).
          const entries = db.createObjectStore("entries", { keyPath: "path" });
          for (const name of ["files", "blobs"] as const) {
            for (let c = await tx.objectStore(name).openCursor(); c; c = await c.continue()) {
              await entries.put({ path: c.value.path, mtime: c.value.mtime });
            }
          }
        }
      },
    });
    return this.db_;
  }

  async list(): Promise<VaultEntry[]> {
    const db = await this.db;
    // Paths and times only: no note text or attachment bytes are read to list them.
    const [entries, folders] = await Promise.all([db.getAll("entries"), db.getAll("folders")]);
    return [
      ...folders.map((f) => ({ path: f.path, kind: "folder" as const, mtime: f.mtime })),
      ...entries.map((f) => ({ path: f.path, kind: "file" as const, mtime: f.mtime })),
    ];
  }

  async read(path: string): Promise<VaultFile | undefined> {
    return (await this.db).get("files", normalizePath(path));
  }

  async write(path: string, content: string): Promise<VaultFile> {
    const file = { path: normalizePath(path), content, mtime: this.now() };
    if (!file.path) throw new Error("A file needs a name.");
    const tx = (await this.db).transaction(["files", "entries"], "readwrite");
    await Promise.all([tx.objectStore("files").put(file), tx.objectStore("entries").put({ path: file.path, mtime: file.mtime }), tx.done]);
    return file;
  }

  async readBinary(path: string): Promise<Uint8Array | undefined> {
    const r = await (await this.db).get("blobs", normalizePath(path));
    return r ? new Uint8Array(r.bytes) : undefined;
  }

  async writeBinary(path: string, bytes: Uint8Array): Promise<VaultEntry> {
    const p = normalizePath(path);
    if (!p) throw new Error("A file needs a name.");
    const mtime = this.now();
    const tx = (await this.db).transaction(["blobs", "entries"], "readwrite");
    await Promise.all([tx.objectStore("blobs").put({ path: p, bytes: bytes.slice().buffer, mtime }), tx.objectStore("entries").put({ path: p, mtime }), tx.done]);
    return { path: p, kind: "file", mtime };
  }

  /** Compare-and-set for attachments, like writeIf. */
  async writeBinaryIf(path: string, expected: Uint8Array | undefined, bytes: Uint8Array | null): Promise<boolean> {
    const p = normalizePath(path);
    const db = await this.db;
    const tx = db.transaction(["blobs", "entries"], "readwrite");
    const blobs = tx.objectStore("blobs");
    const current = await blobs.get(p);
    if (!sameBytes(current ? new Uint8Array(current.bytes) : undefined, expected)) {
      await tx.done;
      return false;
    }
    const entries = tx.objectStore("entries");
    if (bytes === null) await Promise.all([blobs.delete(p), entries.delete(p)]);
    else {
      const mtime = this.now();
      await Promise.all([blobs.put({ path: p, bytes: bytes.slice().buffer, mtime }), entries.put({ path: p, mtime })]);
    }
    await tx.done;
    return true;
  }

  /**
   * Compare-and-set for sync: writes `content` (or deletes, if null) only if the
   * file still holds `expected` (undefined = must not exist). Returns false, and
   * changes nothing, if the user edited the file in the meantime.
   */
  async writeIf(path: string, expected: string | undefined, content: string | null): Promise<boolean> {
    const p = normalizePath(path);
    const db = await this.db;
    const tx = db.transaction(["files", "entries"], "readwrite");
    const files = tx.objectStore("files");
    const current = await files.get(p);
    if (current?.content !== expected) {
      await tx.done;
      return false;
    }
    const entries = tx.objectStore("entries");
    if (content === null) await Promise.all([files.delete(p), entries.delete(p)]);
    else {
      const mtime = this.now();
      await Promise.all([files.put({ path: p, content, mtime }), entries.put({ path: p, mtime })]);
    }
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
    const tx = db.transaction(STORES, "readwrite");
    for (const name of STORES) {
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
    const tx = db.transaction(STORES, "readwrite");
    const files = tx.objectStore("files");
    const folders = tx.objectStore("folders");
    const blobs = tx.objectStore("blobs");
    const entries = tx.objectStore("entries");
    if ((await files.get(dst)) || (await folders.get(dst)) || (await blobs.getKey(dst))) {
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
    for (const key of await blobs.getAllKeys()) {
      if (!isWithin(key, src)) continue;
      const rec = (await blobs.get(key))!;
      await blobs.delete(key);
      await blobs.put({ ...rec, path: moved(key), mtime: now });
    }
    for (const key of await entries.getAllKeys()) {
      if (!isWithin(key, src)) continue;
      await entries.delete(key);
      await entries.put({ path: moved(key), mtime: now });
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
