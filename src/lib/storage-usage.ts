import { openDB } from "idb";
import type { StoredNote } from "./semantic/semantic-index";
import { LocalStore, type StoreUsage } from "./vault/local-store";
import { conflictDbName } from "./sync/conflicts";

/* What CogNotive.ai keeps in this browser, measured part by part for Settings → Storage. */

/** Where transformers.js keeps the search model and its runtime once downloaded from this app. */
export const MODEL_CACHE = "transformers-cache";

export interface RepositoryUsage {
  id: string;
  /** Notes, drawings, canvases and settings. */
  text: StoreUsage["text"];
  attachments: StoreUsage["attachments"];
  /** Search by meaning: a vector per passage, rebuilt from the notes if removed. */
  searchIndex: { count: number; bytes: number };
  /** What was last synced with GitHub, and conflicts waiting for review. */
  sync: number;
}

export interface CacheUsage {
  /** The search model and its runtime. */
  model: number;
  /** The app's own files, kept so it opens without a connection. */
  app: number;
  /** Something shared to the app, waiting to be captured. */
  shared: number;
}

const utf8 = new TextEncoder();
const textBytes = (s: string) => utf8.encode(s).length;
const contentBytes = (c: unknown) => (typeof c === "string" ? textBytes(c) : c instanceof Uint8Array ? c.length : 0);

/** Whether a database exists, without creating it (if the browser can't say, assume it does). */
async function dbExists(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  if (!indexedDB.databases) return true;
  try {
    return (await indexedDB.databases()).some((d) => d.name === name);
  } catch {
    return true;
  }
}

/** Opens an existing database read-only without upgrading it; null if it isn't there. */
async function openExisting(name: string) {
  if (!(await dbExists(name))) return null;
  try {
    return await openDB(name);
  } catch {
    return null;
  }
}

async function searchIndexUsage(vaultId: string): Promise<RepositoryUsage["searchIndex"]> {
  const db = await openExisting(`noted-ai:semantic:${vaultId}`);
  if (!db) return { count: 0, bytes: 0 };
  try {
    if (!db.objectStoreNames.contains("notes")) return { count: 0, bytes: 0 };
    let count = 0;
    let bytes = 0;
    const tx = db.transaction("notes");
    for (let c = await tx.store.openCursor(); c; c = await c.continue()) {
      const note = c.value as StoredNote;
      count++;
      bytes += textBytes(String(c.key)) + textBytes(note.model) + textBytes(note.hash);
      for (const chunk of note.chunks) bytes += chunk.vector.byteLength + textBytes(chunk.preview) + textBytes(chunk.heading ?? "");
    }
    return { count, bytes };
  } finally {
    db.close();
  }
}

async function syncUsage(vaultId: string): Promise<number> {
  let bytes = 0;
  const state = await openExisting(`noted-ai:sync:${vaultId}`);
  if (state) {
    try {
      if (state.objectStoreNames.contains("kv")) {
        for (const v of await state.getAll("kv")) bytes += textBytes(JSON.stringify(v));
      }
    } finally {
      state.close();
    }
  }
  const conflicts = await openExisting(conflictDbName(vaultId));
  if (conflicts) {
    try {
      if (conflicts.objectStoreNames.contains("conflicts")) {
        for (const c of await conflicts.getAll("conflicts")) bytes += contentBytes(c.ours) + contentBytes(c.theirs) + contentBytes(c.base);
      }
    } finally {
      conflicts.close();
    }
  }
  return bytes;
}

/** Everything one repository keeps here. */
export async function repositoryUsage(vaultId: string): Promise<RepositoryUsage> {
  const store = new LocalStore(vaultId);
  try {
    const [files, searchIndex, sync] = await Promise.all([store.usage(), searchIndexUsage(vaultId), syncUsage(vaultId)]);
    return { id: vaultId, ...files, searchIndex, sync };
  } finally {
    await store.close();
  }
}

/** A cached response's size: from its header when there is one, otherwise by reading it. */
async function responseBytes(res: Response): Promise<number> {
  const header = Number(res.headers.get("content-length"));
  if (Number.isFinite(header) && header > 0) return header;
  return (await res.blob()).size;
}

/** The browser caches CogNotive.ai uses (Cache Storage), by purpose. */
export async function cacheUsage(): Promise<CacheUsage> {
  const out: CacheUsage = { model: 0, app: 0, shared: 0 };
  if (typeof caches === "undefined") return out;
  for (const name of await caches.keys()) {
    const part: keyof CacheUsage | null = name === MODEL_CACHE ? "model" : name === "noted-ai-share" ? "shared" : name.startsWith("noted-ai-") ? "app" : null;
    if (!part) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (res) out[part] += await responseBytes(res);
    }
  }
  return out;
}

/** Removes the downloaded search model (search by meaning downloads it again from this app when next used). */
export async function removeModel(): Promise<boolean> {
  return typeof caches !== "undefined" && caches.delete(MODEL_CACHE);
}

export interface StoragePart {
  id: "notes" | "attachments" | "model" | "index" | "rest";
  label: string;
  bytes: number;
  /** What's in it, in a few words. */
  detail: string;
}

const files = (n: number) => `${n.toLocaleString()} ${n === 1 ? "file" : "files"}`;

/**
 * The parts shown in Settings → Storage, in a fixed order. `used` is the browser's own
 * figure for the whole site (it includes overhead measured nowhere else), if it gave one.
 */
export function storageParts(repos: RepositoryUsage[], cache: CacheUsage, used?: number): { parts: StoragePart[]; total: number } {
  const sum = (f: (r: RepositoryUsage) => number) => repos.reduce((n, r) => n + f(r), 0);
  const sync = sum((r) => r.sync);
  const measured =
    sum((r) => r.text.bytes + r.attachments.bytes + r.searchIndex.bytes) + sync + cache.model + cache.app + cache.shared;
  const total = Math.max(measured, used ?? 0);
  const overhead = total - measured;
  const indexed = sum((r) => r.searchIndex.count);
  const rest = [
    sync ? "sync records" : "",
    cache.app ? "app files for offline use" : "",
    cache.shared ? "a shared item waiting" : "",
    overhead > 0 ? "browser overhead" : "",
  ].filter(Boolean);
  return {
    total,
    parts: [
      { id: "notes", label: "Notes and drawings", bytes: sum((r) => r.text.bytes), detail: files(sum((r) => r.text.count)) },
      { id: "attachments", label: "Attachments", bytes: sum((r) => r.attachments.bytes), detail: files(sum((r) => r.attachments.count)) },
      {
        id: "model",
        label: "Search model",
        bytes: cache.model,
        detail: cache.model ? "Downloaded from this app for search by meaning" : "Not downloaded",
      },
      {
        id: "index",
        label: "Search by meaning index",
        bytes: sum((r) => r.searchIndex.bytes),
        detail: indexed ? `${indexed.toLocaleString()} ${indexed === 1 ? "note" : "notes"} indexed` : "Nothing indexed",
      },
      { id: "rest", label: "Everything else", bytes: cache.app + cache.shared + sync + overhead, detail: rest.length ? capitalise(rest.join(", ")) : "Nothing" },
    ],
  };
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
