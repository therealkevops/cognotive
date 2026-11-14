"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { readPref, writePref } from "@/lib/prefs";
import { NoteIndex } from "@/lib/search/note-index";
import { LocalStore } from "@/lib/vault/local-store";
import {
  basename,
  dirname,
  extname,
  isMarkdown,
  isWithin,
  joinPath,
  uniquePath,
  validateName,
} from "@/lib/vault/paths";
import type { VaultEntry, VaultStore } from "@/lib/vault/types";
import { WELCOME_NOTES } from "@/lib/vault/welcome";

const SAVE_DELAY_MS = 400;

export type SaveState = "saved" | "saving" | "error";

export interface ActiveNote {
  path: string;
  /** Content as loaded; the editor owns edits after that. */
  initial: string;
  /** Changes whenever the editor must reload `initial` (a different note was opened). */
  version: number;
}

export interface VaultApi {
  ready: boolean;
  vaultId: string;
  entries: VaultEntry[];
  index: NoteIndex;
  /** Increments whenever the index changes, so search views can recompute. */
  indexVersion: number;
  active: ActiveNote | null;
  /** Latest text of the active note, including unsaved edits. */
  activeText: string;
  saveState: SaveState;
  error: string | null;
  clearError(): void;
  open(path: string | null): Promise<void>;
  edit(text: string): void;
  createNote(folder?: string, name?: string): Promise<string | undefined>;
  createFolder(parent?: string): Promise<string | undefined>;
  /** Renames within the same folder. For notes, `newName` excludes ".md". */
  rename(path: string, newName: string): Promise<boolean>;
  move(path: string, toFolder: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Case-insensitive, like most file systems Obsidian vaults live on. */
  exists(path: string): boolean;
}

const VaultContext = createContext<VaultApi | null>(null);

export function useVault(): VaultApi {
  const v = useContext(VaultContext);
  if (!v) throw new Error("useVault must be used inside <VaultProvider>");
  return v;
}

export function VaultProvider({
  vaultId,
  store: injectedStore,
  children,
}: {
  vaultId: string;
  /** Defaults to a LocalStore for `vaultId`. Tests pass their own. */
  store?: VaultStore;
  children: ReactNode;
}) {
  const store = useMemo<VaultStore>(
    () => injectedStore ?? new LocalStore(vaultId),
    [injectedStore, vaultId],
  );
  const index = useMemo(() => new NoteIndex(), []);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [indexVersion, setIndexVersion] = useState(0);
  const [active, setActive] = useState<ActiveNote | null>(null);
  const [activeText, setActiveText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);

  const pending = useRef<{ path: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePath = useRef<string | null>(null);
  const version = useRef(0);
  // Lets stable callbacks read the latest entries without re-creating them.
  const entriesRef = useRef<VaultEntry[]>([]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  const bumpIndex = useCallback(() => setIndexVersion((v) => v + 1), []);

  const refresh = useCallback(async () => {
    setEntries(await store.list());
  }, [store]);

  /** Writes any pending edit now. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    try {
      const file = await store.write(p.path, p.text);
      index.set(p.path, p.text);
      bumpIndex();
      if (!pending.current) setSaveState("saved");
      setEntries((prev) => prev.map((e) => (e.path === p.path ? { ...e, mtime: file.mtime } : e)));
    } catch (e) {
      setSaveState("error");
      fail(e);
    }
  }, [store, index, bumpIndex, fail]);

  const open = useCallback(
    async (path: string | null) => {
      await flush();
      activePath.current = path;
      if (!path) {
        setActive(null);
        setActiveText("");
        writePref(`vault:${vaultId}:last`, null);
        return;
      }
      const file = await store.read(path);
      if (activePath.current !== path) return; // a newer open won
      const text = file?.content ?? "";
      version.current += 1;
      setActive({ path, initial: text, version: version.current });
      setActiveText(text);
      writePref(`vault:${vaultId}:last`, path);
    },
    [flush, store, vaultId],
  );

  // Load the vault: seed it if brand new, index every note, reopen the last note.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = await store.list();
      if (list.length === 0 && !readPref(`vault:${vaultId}:seeded`, false)) {
        for (const [path, content] of Object.entries(WELCOME_NOTES)) {
          await store.write(path, content);
        }
        writePref(`vault:${vaultId}:seeded`, true);
        list = await store.list();
      }
      index.clear();
      for (const e of list) {
        if (e.kind === "file" && isMarkdown(e.path)) {
          const f = await store.read(e.path);
          if (f) index.set(f.path, f.content);
        }
      }
      if (cancelled) return;
      setEntries(list);
      bumpIndex();
      const last = readPref<string | null>(`vault:${vaultId}:last`, null);
      const notes = list.filter((e) => e.kind === "file" && isMarkdown(e.path));
      const start =
        notes.find((f) => f.path === last) ??
        notes.find((f) => f.path === "Welcome.md") ??
        notes[0];
      await open(start?.path ?? null);
      if (!cancelled) setReady(true);
    })().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [store, index, vaultId, open, bumpIndex, fail]);

  // Save when the tab is hidden or closed.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onHide = () => void flush();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  const edit = useCallback(
    (text: string) => {
      const path = activePath.current;
      if (!path) return;
      setActiveText(text);
      pending.current = { path, text };
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const exists = useCallback((p: string) => {
    const lower = p.toLowerCase();
    return entriesRef.current.some((e) => e.path.toLowerCase() === lower);
  }, []);

  const createNote = useCallback(
    async (folder = "", name = "Untitled") => {
      try {
        const err = validateName(name);
        if (err) throw new Error(err);
        const path = uniquePath(joinPath(folder, `${name.trim()}.md`), exists);
        await store.write(path, "");
        index.set(path, "");
        bumpIndex();
        await refresh();
        await open(path);
        return path;
      } catch (e) {
        fail(e);
      }
    },
    [store, index, exists, refresh, open, bumpIndex, fail],
  );

  const createFolder = useCallback(
    async (parent = "") => {
      try {
        const path = uniquePath(joinPath(parent, "New folder"), exists);
        await store.createFolder(path);
        await refresh();
        return path;
      } catch (e) {
        fail(e);
      }
    },
    [store, exists, refresh, fail],
  );

  /** Re-keys the index and the open note after `from` moved to `to`. */
  const afterMove = useCallback(
    async (from: string, to: string) => {
      const list = await store.list();
      for (const e of list) {
        if (e.kind !== "file" || !isMarkdown(e.path) || !isWithin(e.path, to)) continue;
        index.remove(joinPath(from, e.path.slice(to.length)));
        const f = await store.read(e.path);
        if (f) index.set(f.path, f.content);
      }
      setEntries(list);
      bumpIndex();
      const current = activePath.current;
      if (current && isWithin(current, from)) {
        const moved = joinPath(to, current.slice(from.length));
        activePath.current = moved;
        // Same content, so keep `version`: the editor keeps its state and undo history.
        setActive((a) => (a ? { ...a, path: moved } : a));
        writePref(`vault:${vaultId}:last`, moved);
      }
    },
    [store, index, vaultId, bumpIndex],
  );

  const renameOrMove = useCallback(
    async (from: string, to: string) => {
      if (from === to) return;
      // A case-only rename ("note" → "Note") is allowed; anything else must be free.
      if (from.toLowerCase() !== to.toLowerCase() && exists(to)) {
        throw new Error(`"${basename(to)}" already exists in that folder.`);
      }
      await flush();
      await store.rename(from, to);
      await afterMove(from, to);
    },
    [exists, flush, store, afterMove],
  );

  const rename = useCallback(
    async (path: string, newName: string) => {
      try {
        const err = validateName(newName);
        if (err) throw new Error(err);
        const entry = entriesRef.current.find((e) => e.path === path);
        const ext = entry?.kind === "file" ? extname(path) : "";
        const keepExt = ext && !newName.trim().toLowerCase().endsWith(ext) ? ext : "";
        await renameOrMove(path, joinPath(dirname(path), newName.trim() + keepExt));
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [renameOrMove, fail],
  );

  const move = useCallback(
    async (path: string, toFolder: string) => {
      try {
        if (dirname(path) === toFolder) return;
        if (isWithin(toFolder, path)) throw new Error("Can't move a folder into itself.");
        await renameOrMove(path, joinPath(toFolder, basename(path)));
      } catch (e) {
        fail(e);
      }
    },
    [renameOrMove, fail],
  );

  const remove = useCallback(
    async (path: string) => {
      try {
        const current = activePath.current;
        if (current && isWithin(current, path)) {
          pending.current = null;
          await open(null);
        }
        const removed = entriesRef.current.filter((e) => isWithin(e.path, path));
        await store.delete(path);
        for (const e of removed) index.remove(e.path);
        bumpIndex();
        await refresh();
      } catch (e) {
        fail(e);
      }
    },
    [store, index, refresh, open, bumpIndex, fail],
  );

  const clearError = useCallback(() => setError(null), []);

  const api = useMemo<VaultApi>(
    () => ({
      ready,
      vaultId,
      entries,
      index,
      indexVersion,
      active,
      activeText,
      saveState,
      error,
      clearError,
      open,
      edit,
      createNote,
      createFolder,
      rename,
      move,
      remove,
      exists,
    }),
    [
      ready,
      vaultId,
      entries,
      index,
      indexVersion,
      active,
      activeText,
      saveState,
      error,
      clearError,
      open,
      edit,
      createNote,
      createFolder,
      rename,
      move,
      remove,
      exists,
    ],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}
