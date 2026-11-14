import { unzipSync, zipSync, type Zippable } from "fflate";
import { isBinary, normalizePath } from "./paths";
import type { VaultStore } from "./types";

/** The whole vault as a .zip: notes, drawings, attachments and .noted/ settings. */
export async function exportVault(store: VaultStore): Promise<Uint8Array> {
  const files: Zippable = {};
  for (const e of await store.list()) {
    if (e.kind !== "file") continue;
    const bytes = isBinary(e.path)
      ? await store.readBinary(e.path)
      : new TextEncoder().encode((await store.read(e.path))?.content ?? "");
    if (bytes) files[e.path] = [bytes, { mtime: new Date(e.mtime || Date.now()) }];
  }
  return zipSync(files, { level: 6 });
}

/**
 * Reads a zip into vault paths. If every file sits inside one top-level folder
 * (a zipped vault folder), that folder is dropped. Skips folders, macOS junk,
 * .git and .obsidian.
 */
export function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  const raw = unzipSync(zip);
  let entries = Object.entries(raw).filter(
    ([p]) =>
      !p.endsWith("/") &&
      !p.startsWith("__MACOSX/") &&
      !p.split("/").some((seg) => seg === ".git" || seg === ".obsidian" || seg === ".DS_Store"),
  );
  const tops = new Set(entries.map(([p]) => p.split("/")[0]));
  if (tops.size === 1 && entries.every(([p]) => p.includes("/"))) {
    const top = [...tops][0].length + 1;
    entries = entries.map(([p, b]) => [p.slice(top), b]);
  }
  const out = new Map<string, Uint8Array>();
  for (const [p, b] of entries) {
    try {
      const path = normalizePath(p);
      if (path) out.set(path, b);
    } catch {
      // ".." in a zip path: ignore the entry
    }
  }
  return out;
}
