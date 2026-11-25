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
import type { LinkIndex } from "@/lib/links/link-index";
import type { NoteIndex } from "@/lib/search/note-index";
import { drawingToSvgText, drawingToSvgUrl } from "@/lib/drawing/svg";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  SETTINGS_PATH,
  type VaultSettings,
} from "@/lib/vault/settings";
import { drawingJson } from "@/lib/drawing/obsidian";
import { EMPTY_CANVAS } from "@/lib/canvas/format";
import { EMPTY_DRAWING } from "@/lib/drawing/parse";
import { VaultIndexes } from "@/lib/vault/indexes";
import { exportVault } from "@/lib/vault/zip";
import { LocalStore } from "@/lib/vault/local-store";
import {
  basename,
  displayName,
  dirname,
  extensionFor,
  extname,
  fileSuffix,
  isBinary,
  isCanvas,
  isDrawing,
  isMarkdown,
  isNote,
  isWithin,
  mimeType,
  joinPath,
  uniquePath,
  validateName,
} from "@/lib/vault/paths";
import type { VaultEntry, VaultStore } from "@/lib/vault/types";
import { withNewNoteProperties } from "@/lib/vault/new-note-properties";
import { setPropertyIn } from "@/lib/vault/property-ops";
import {
  movedFileProperties,
  parseFileProperties,
  PROPERTIES_PATH,
  serializeFileProperties,
  withFileProperty,
  withoutFileProperties,
  type FileProperties,
} from "@/lib/vault/file-properties";
import { WELCOME_NOTES } from "@/lib/vault/welcome";
import { decideSave } from "@/lib/vault/save-merge";
import { orderAfterMove } from "@/lib/vault/file-order";
import { shrinkImage } from "@/lib/attachments/shrink";
import { formatBytes, storageLimit, storageStatus, withinLimit } from "@/lib/storage-safety";

const SAVE_DELAY_MS = 400;
/** Where pasted, dropped and uploaded files go. */
export const ATTACHMENT_FOLDER = "attachments";

/** "Pasted image 20261114093012.png", like Obsidian. */
function attachmentName(file: File, now = new Date()): string {
  const ext = extname(file.name) || extensionFor(file.type) || "";
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
  if (!generic) return file.name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return `Pasted image ${stamp}${ext}`;
}

export type SaveState = "saved" | "saving" | "error";

export interface ActiveNote {
  path: string;
  /** Content as loaded; the editor owns edits after that. */
  initial: string;
  /** Changes whenever the editor must reload `initial` (a different note was opened). */
  version: number;
}

export interface IndexedVault {
  links: LinkIndex;
  search: NoteIndex;
  version: number;
}

export interface VaultApi {
  ready: boolean;
  vaultId: string;
  entries: VaultEntry[];
  index: NoteIndex;
  /** Links, backlinks, tags and properties of every note. Changes with `indexVersion`. */
  links: LinkIndex;
  /** Increments whenever the index changes, so search views can recompute. */
  indexVersion: number;
  /**
   * The indexes, as an object that is replaced whenever they change. Views that derive
   * something from the index read it through this and list `vault.indexed` as a dependency.
   */
  indexed: IndexedVault;
  active: ActiveNote | null;
  /** Latest text of the active note, including unsaved edits. */
  activeText: string;
  /** Latest text of a note: the editor's text if it is open, otherwise the indexed text. */
  textOf(path: string): string | undefined;
  saveState: SaveState;
  error: string | null;
  clearError(): void;
  open(path: string | null): Promise<void>;
  edit(text: string): void;
  /** Writes any pending edit to the store now. */
  flush(): Promise<void>;
  /** Increments after every local change that reached the store (for sync scheduling). */
  changeCounter: number;
  /**
   * Re-reads the store after something else (sync) changed it. Reloads the open
   * note if it was among `changed` and has no unsaved edits.
   */
  reload(changed: string[]): Promise<void>;
  createNote(folder?: string, name?: string): Promise<string | undefined>;
  createFolder(parent?: string): Promise<string | undefined>;
  /** Creates an empty Excalidraw drawing and opens it. */
  createDrawing(folder?: string, name?: string): Promise<string | undefined>;
  /** Creates an empty canvas board (.canvas) and opens it. */
  createCanvas(folder?: string, name?: string): Promise<string | undefined>;
  /** Saves files (pasted, dropped or uploaded) as attachments. Returns their paths. */
  addAttachments(files: File[], folder?: string): Promise<string[]>;
  /**
   * A URL to show a file: an object URL for images and PDFs, an SVG rendering
   * for drawings. Cached until the file changes.
   */
  fileUrl(path: string, opts?: { dark?: boolean }): Promise<string | null>;
  /** Renames within the same folder. For notes, `newName` excludes ".md". */
  rename(path: string, newName: string): Promise<boolean>;
  move(path: string, toFolder: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** The whole vault as a .zip file's bytes. */
  exportZip(): Promise<Uint8Array>;
  /**
   * Adds files (from an imported zip). Identical files are skipped; a different
   * file at the same path is kept and the import gets a numbered name.
   */
  importFiles(files: Map<string, Uint8Array>): Promise<{ added: number; skipped: number; renamed: number }>;
  /** This vault's settings (.noted/settings.json). */
  settings: VaultSettings;
  /** An attachment's properties (kept in .noted/properties.json). */
  fileProperties(path: string): Record<string, unknown>;
  /** Sets (or, with undefined, removes) a property of an attachment. */
  setFileProperty(path: string, key: string, value: unknown): Promise<void>;
  /** Sets (or removes) a property of any file: note, drawing, canvas or attachment. */
  setProperty(path: string, key: string, value: unknown): Promise<void>;
  updateSettings(patch: Partial<VaultSettings>): Promise<void>;
  /** Creates a note with content (e.g. from a template) and opens it. */
  createNoteWith(path: string, content: string): Promise<string | undefined>;
  /** Replaces a note's text from outside the editor (e.g. linking a mention). Reloads it if open. */
  writeNote(path: string, content: string): Promise<void>;
  /** Writes any file (text or bytes), creating or replacing it. Reloads it if open. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /** Copies files and folders as planned (see planCopy); returns how many files were copied. */
  copyFiles(plan: Array<{ from: string; to: string; kind: "file" | "folder" }>): Promise<number>;
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
  seed = true,
  children,
}: {
  vaultId: string;
  /** Defaults to a LocalStore for `vaultId`. */
  store?: VaultStore;
  /** Create the welcome note in a brand-new vault. Off for vaults filled by sync. */
  seed?: boolean;
  children: ReactNode;
}) {
  const store = useMemo<VaultStore>(
    () => injectedStore ?? new LocalStore(vaultId),
    [injectedStore, vaultId],
  );
  const indexes = useMemo(() => new VaultIndexes(), []);
  const index = indexes.search;
  const links = indexes.links;
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [indexVersion, setIndexVersion] = useState(0);
  const [active, setActive] = useState<ActiveNote | null>(null);
  const [activeText, setActiveText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [changeCounter, setChangeCounter] = useState(0);
  const [settings, setSettings] = useState<VaultSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  // Attachments' properties, and keeping the link index in step with them.
  const [fileProps, setFileProps] = useState<FileProperties>({});
  const filePropsRef = useRef<FileProperties>({});
  const applyFileProps = useCallback(
    (next: FileProperties) => {
      for (const p of Object.keys(filePropsRef.current)) if (!(p in next)) indexes.links.setFileProperties(p, null);
      for (const [p, props] of Object.entries(next)) indexes.links.setFileProperties(p, props);
      filePropsRef.current = next;
      setFileProps(next);
    },
    [indexes],
  );
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const changed = useCallback(() => setChangeCounter((c) => c + 1), []);

  const pending = useRef<{ path: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePath = useRef<string | null>(null);
  /** The open file as this window last loaded or saved it: what another window's change is merged against. */
  const loaded = useRef<{ path: string; text: string } | null>(null);
  const openRef = useRef<(path: string | null) => Promise<void>>(async () => {});
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
  const indexed = useMemo<IndexedVault>(() => ({ links, search: index, version: indexVersion }), [links, index, indexVersion]);

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
      // Another window may have saved this file since this one loaded it: merge, or keep both.
      const base = loaded.current?.path === p.path ? loaded.current.text : undefined;
      const theirs = base === undefined ? undefined : (await store.read(p.path))?.content;
      const decision = base === undefined ? { text: p.text } : decideSave(p.path, p.text, base, theirs, (x) => entriesRef.current.some((e) => e.path === x));
      if (decision.copy) {
        await store.write(decision.copy.path, decision.copy.content);
        indexes.set(decision.copy.path, decision.copy.content);
        setEntries(await store.list());
        setError(
          `"${displayName(p.path)}" was also changed in another window, in the same place. This window's version is saved; the other is kept as "${displayName(decision.copy.path)}".`,
        );
      }
      const file = await store.write(p.path, decision.text);
      indexes.set(p.path, decision.text);
      const reopen = decision.text !== p.text && activePath.current === p.path && !pending.current;
      // If the merged text isn't shown yet (more typing is pending), keep merging against the old base.
      if (loaded.current?.path === p.path && (reopen || decision.text === p.text)) loaded.current = { path: p.path, text: decision.text };
      bumpIndex();
      if (!pending.current) setSaveState("saved");
      setEntries((prev) => prev.map((e) => (e.path === p.path ? { ...e, mtime: file.mtime } : e)));
      if (isDrawing(p.path) && settingsRef.current.drawingSvgCopy) {
        // "Name.excalidraw.svg" next to the drawing, so it shows on github.com.
        const svg = await drawingToSvgText(drawingJson(p.path, p.text), false).catch(() => null);
        if (svg) {
          await store.writeBinary(`${p.path}.svg`, new TextEncoder().encode(svg));
          indexes.addFile(`${p.path}.svg`);
          setEntries(await store.list());
        }
      }
      changed();
      if (reopen) await openRef.current(p.path); // show the merged text
    } catch (e) {
      setSaveState("error");
      fail(e);
    }
  }, [store, indexes, bumpIndex, fail, changed]);

  const open = useCallback(
    async (path: string | null) => {
      await flush();
      activePath.current = path;
      if (!path) {
        setActive(null);
        setActiveText("");
        // "" (not null): nothing open, so a reload doesn't reopen Welcome.
        writePref(`vault:${vaultId}:last`, "");
        return;
      }
      const file = await store.read(path);
      if (activePath.current !== path) return; // a newer open won
      const text = file?.content ?? "";
      loaded.current = { path, text };
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
      if (seed && list.length === 0 && !readPref(`vault:${vaultId}:seeded`, false)) {
        for (const [path, content] of Object.entries(WELCOME_NOTES)) {
          await store.write(path, content);
        }
        writePref(`vault:${vaultId}:seeded`, true);
        list = await store.list();
      }
      setSettings(parseSettings((await store.read(SETTINGS_PATH))?.content));
      indexes.clear();
      for (const e of list) {
        if (e.kind !== "file") continue;
        if (isBinary(e.path)) indexes.addFile(e.path);
        else {
          const f = await store.read(e.path);
          if (f) indexes.set(f.path, f.content);
        }
      }
      if (cancelled) return;
      filePropsRef.current = {};
      applyFileProps(parseFileProperties((await store.read(PROPERTIES_PATH))?.content));
      setEntries(list);
      bumpIndex();
      const last = readPref<string | null>(`vault:${vaultId}:last`, null);
      const notes = list.filter((e) => e.kind === "file" && isNote(e.path));
      const start =
        last === ""
          ? null
          : // The last open file, whatever it was (a canvas, a drawing, a PDF…), else Welcome.
            (list.find((f) => f.kind === "file" && f.path === last) ?? notes.find((f) => f.path === "Welcome.md") ?? notes[0]);
      await open(start?.path ?? null);
      if (!cancelled) setReady(true);
    })().catch(fail);
    return () => {
      cancelled = true;
    };
  }, [store, indexes, vaultId, open, bumpIndex, fail, seed, applyFileProps]);

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

  const textOf = useCallback(
    (path: string) => (path === active?.path ? activeText : links.content(path)),
    [active?.path, activeText, links],
  );

  const exists = useCallback((p: string) => {
    const lower = p.toLowerCase();
    return entriesRef.current.some((e) => e.path.toLowerCase() === lower);
  }, []);

  /** A new note starts with the properties chosen in settings (not templates themselves). */
  const newNoteContent = useCallback(
    (path: string, content: string) =>
      isMarkdown(path) && !(settings.templateFolder && isWithin(path, settings.templateFolder))
        ? withNewNoteProperties(content, settings.newNoteProperties)
        : content,
    [settings.newNoteProperties, settings.templateFolder],
  );

  const createNote = useCallback(
    async (folder = "", name = "Untitled") => {
      try {
        const err = validateName(name);
        if (err) throw new Error(err);
        const path = uniquePath(joinPath(folder, `${name.trim()}.md`), exists);
        const content = newNoteContent(path, "");
        await store.write(path, content);
        indexes.set(path, content);
        bumpIndex();
        await refresh();
        changed();
        await open(path);
        return path;
      } catch (e) {
        fail(e);
      }
    },
    [store, indexes, exists, refresh, open, bumpIndex, fail, changed, newNoteContent],
  );

  const createDrawing = useCallback(
    async (folder = "", name = "Drawing") => {
      try {
        const err = validateName(name);
        if (err) throw new Error(err);
        const path = uniquePath(joinPath(folder, `${name.trim()}.excalidraw`), exists);
        await store.write(path, EMPTY_DRAWING);
        indexes.set(path, EMPTY_DRAWING);
        bumpIndex();
        await refresh();
        changed();
        await open(path);
        return path;
      } catch (e) {
        fail(e);
      }
    },
    [store, indexes, exists, refresh, open, bumpIndex, fail, changed],
  );
  const createCanvas = useCallback(
    async (folder = "", name = "Canvas") => {
      try {
        const err = validateName(name);
        if (err) throw new Error(err);
        const path = uniquePath(joinPath(folder, `${name.trim()}.canvas`), exists);
        await store.write(path, EMPTY_CANVAS);
        indexes.set(path, EMPTY_CANVAS);
        bumpIndex();
        await refresh();
        changed();
        await open(path);
        return path;
      } catch (e) {
        fail(e);
      }
    },
    [store, indexes, exists, refresh, open, bumpIndex, fail, changed],
  );

  const addAttachments = useCallback(
    async (files: File[], folder = settingsRef.current.attachmentFolder || ATTACHMENT_FOLDER) => {
      const saved: string[] = [];
      // A limit set in Settings → Storage stops new files (never notes) once it's reached.
      const limit = storageLimit.get();
      let used = limit ? (await storageStatus()).usage : undefined;
      const refused: string[] = [];
      try {
        for (const added of files) {
          // Images are kept smaller (and without their hidden details); see lib/attachments/shrink.
          const file = added.type.startsWith("image/") ? await shrinkImage(added) : added;
          if (!withinLimit(used, limit, file.size)) {
            refused.push(added.name || "a pasted image");
            continue;
          }
          if (used !== undefined) used += file.size;
          const name = attachmentName(file);
          const path = uniquePath(joinPath(folder, name), (p) => exists(p) || saved.includes(p));
          if (isBinary(path)) {
            await store.writeBinary(path, new Uint8Array(await file.arrayBuffer()));
            indexes.addFile(path);
          } else {
            const text = await file.text();
            await store.write(path, text);
            indexes.set(path, text);
          }
          saved.push(path);
        }
      } catch (e) {
        fail(e);
      }
      if (refused.length) {
        fail(
          new Error(
            `Not added: ${refused.length === 1 ? refused[0] : `${refused.length} files`}. It would go over the ${formatBytes(limit!)} storage limit set in Settings → Storage.`,
          ),
        );
      }
      if (saved.length) {
        bumpIndex();
        await refresh();
        changed();
      }
      return saved;
    },
    [store, indexes, exists, refresh, bumpIndex, changed, fail],
  );

  const urlCache = useRef(new Map<string, { key: string; url: Promise<string | null> }>());
  useEffect(() => {
    const cache = urlCache.current;
    return () => {
      for (const { url } of cache.values()) void url.then((u) => u && URL.revokeObjectURL(u));
      cache.clear();
    };
  }, [store]);

  const fileUrl = useCallback(
    async (path: string, opts: { dark?: boolean } = {}) => {
      const mtime = entriesRef.current.find((e) => e.path === path)?.mtime ?? 0;
      const cacheKey = `${path}|${opts.dark ? "dark" : "light"}`;
      const key = `${mtime}`;
      const hit = urlCache.current.get(cacheKey);
      if (hit && hit.key === key) return hit.url;
      if (hit) void hit.url.then((u) => u && URL.revokeObjectURL(u));
      const url = (async () => {
        if (isDrawing(path)) {
          const f = await store.read(path);
          return f ? drawingToSvgUrl(drawingJson(path, f.content), !!opts.dark) : null;
        }
        if (!isBinary(path)) return null;
        const bytes = await store.readBinary(path);
        return bytes ? URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType(path) })) : null;
      })().catch(() => null);
      urlCache.current.set(cacheKey, { key, url });
      return url;
    },
    [store],
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

  /** Re-keys the indexes and the open note after `from` moved to `to`. Returns old → new file paths. */
  const afterMove = useCallback(
    async (from: string, to: string) => {
      const list = await store.list();
      const moved: Array<[string, string]> = [];
      for (const e of list) {
        if (e.kind !== "file" || !isWithin(e.path, to)) continue;
        const old = joinPath(from, e.path.slice(to.length));
        moved.push([old, e.path]);
        indexes.remove(old);
        if (isBinary(e.path)) indexes.addFile(e.path);
        else {
          const f = await store.read(e.path);
          if (f) indexes.set(f.path, f.content);
        }
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
      return moved;
    },
    [store, indexes, vaultId, bumpIndex],
  );

  /** Writes attachments' properties and updates the index. */
  const saveFileProps = useCallback(
    async (next: FileProperties) => {
      await store.write(PROPERTIES_PATH, serializeFileProperties(next));
      applyFileProps(next);
      bumpIndex();
      changed();
    },
    [store, applyFileProps, bumpIndex, changed],
  );
  const fileProperties = useCallback((path: string) => fileProps[path] ?? {}, [fileProps]);
  const setFileProperty = useCallback(
    async (path: string, key: string, value: unknown) => {
      try {
        await saveFileProps(withFileProperty(filePropsRef.current, path, key, value));
      } catch (e) {
        fail(e);
      }
    },
    [saveFileProps, fail],
  );

  const renameOrMove = useCallback(
    async (from: string, to: string) => {
      if (from === to) return;
      // A case-only rename ("note" → "Note") is allowed; anything else must be free.
      if (from.toLowerCase() !== to.toLowerCase() && exists(to)) {
        throw new Error(`"${basename(to)}" already exists in that folder.`);
      }
      await flush();
      const before = links.snapshotResolver();
      await store.rename(from, to);
      // A drawing's SVG copy follows it.
      if (isDrawing(from) && entriesRef.current.some((e) => e.path === `${from}.svg`)) {
        await store.rename(`${from}.svg`, `${to}.svg`).catch(() => {});
      }
      const moved = await afterMove(from, to);
      const props = movedFileProperties(filePropsRef.current, moved);
      if (props) await saveFileProps(props);
      // Its place in the file tree's custom order goes with it.
      const order = orderAfterMove(settingsRef.current.fileOrder, from, to);
      if (order) {
        const next = { ...settingsRef.current, fileOrder: order };
        settingsRef.current = next;
        setSettings(next);
        await store.write(SETTINGS_PATH, serializeSettings(next));
      }

      // Update links in other notes so they follow the renamed files.
      const rewritten = new Set<string>();
      for (const [oldPath, newPath] of moved) {
        for (const [notePath, text] of links.rewriteLinksTo(oldPath, newPath, before)) {
          await store.write(notePath, text);
          indexes.set(notePath, text);
          rewritten.add(notePath);
        }
      }
      if (rewritten.size) {
        bumpIndex();
        setEntries(await store.list());
        const current = activePath.current;
        if (current && rewritten.has(current)) await open(current);
      }
      changed();
    },
    [exists, flush, store, afterMove, changed, links, indexes, bumpIndex, open, saveFileProps],
  );

  const rename = useCallback(
    async (path: string, newName: string) => {
      try {
        const err = validateName(newName);
        if (err) throw new Error(err);
        const entry = entriesRef.current.find((e) => e.path === path);
        // A drawing keeps all of ".excalidraw.md", not just ".md".
        const ext = entry?.kind === "file" ? fileSuffix(path) : "";
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
        const removed = entriesRef.current.filter(
          (e) => isWithin(e.path, path) || (isDrawing(path) && e.path === `${path}.svg`),
        );
        await store.delete(path);
        if (isDrawing(path)) await store.delete(`${path}.svg`);
        for (const e of removed) indexes.remove(e.path);
        const props = withoutFileProperties(filePropsRef.current, removed.map((e) => e.path));
        if (props) await saveFileProps(props);
        bumpIndex();
        await refresh();
        changed();
      } catch (e) {
        fail(e);
      }
    },
    [store, indexes, refresh, open, bumpIndex, fail, changed, saveFileProps],
  );

  const clearError = useCallback(() => setError(null), []);

  const updateSettings = useCallback(
    async (patch: Partial<VaultSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      try {
        await store.write(SETTINGS_PATH, serializeSettings(next));
        changed();
      } catch (e) {
        fail(e);
      }
    },
    [store, changed, fail],
  );

  const exportZip = useCallback(async () => {
    await flush();
    return exportVault(store);
  }, [flush, store]);

  const importFiles = useCallback(
    async (files: Map<string, Uint8Array>) => {
      await flush();
      const result = { added: 0, skipped: 0, renamed: 0 };
      const same = (a: Uint8Array | undefined, b: Uint8Array) =>
        !!a && a.length === b.length && a.every((x, i) => x === b[i]);
      try {
        for (const [p, bytes] of files) {
          const binary = isBinary(p);
          let existing: Uint8Array | undefined;
          if (binary) existing = await store.readBinary(p);
          else {
            const f = await store.read(p);
            existing = f ? new TextEncoder().encode(f.content) : undefined;
          }
          if (existing && same(existing, bytes)) {
            result.skipped++;
            continue;
          }
          if (existing && p === SETTINGS_PATH) {
            result.skipped++; // keep this vault's settings
            continue;
          }
          const target = existing ? uniquePath(p, (x) => exists(x) || files.has(x)) : p;
          if (existing) result.renamed++;
          else result.added++;
          if (binary) {
            await store.writeBinary(target, bytes);
            indexes.addFile(target);
          } else {
            const text = new TextDecoder().decode(bytes);
            await store.write(target, text);
            indexes.set(target, text);
          }
        }
        if (files.has(SETTINGS_PATH)) setSettings(parseSettings((await store.read(SETTINGS_PATH))?.content));
        bumpIndex();
        await refresh();
        changed();
      } catch (e) {
        fail(e);
      }
      return result;
    },
    [flush, store, exists, indexes, bumpIndex, refresh, changed, fail],
  );

  const createNoteWith = useCallback(
    async (path: string, content: string) => {
      try {
        if (exists(path)) {
          await open(path);
          return path;
        }
        content = newNoteContent(path, content);
        await store.write(path, content);
        indexes.set(path, content);
        bumpIndex();
        await refresh();
        changed();
        await open(path);
        return path;
      } catch (e) {
        fail(e);
      }
    },
    [store, indexes, exists, refresh, open, bumpIndex, changed, fail, newNoteContent],
  );

  const writeNote = useCallback(
    async (path: string, content: string) => {
      try {
        await flush();
        await store.write(path, content);
        indexes.set(path, content);
        bumpIndex();
        setEntries(await store.list());
        if (activePath.current === path) await open(path);
        changed();
      } catch (e) {
        fail(e);
      }
    },
    [flush, store, indexes, bumpIndex, open, changed, fail],
  );

  const writeFile = useCallback(
    async (path: string, content: string | Uint8Array) => {
      if (typeof content === "string") return writeNote(path, content);
      try {
        await flush();
        await store.writeBinary(path, content);
        indexes.addFile(path);
        bumpIndex();
        setEntries(await store.list());
        if (activePath.current === path) await open(path);
        changed();
      } catch (e) {
        fail(e);
      }
    },
    [writeNote, flush, store, indexes, bumpIndex, open, changed, fail],
  );

  const copyFiles = useCallback(
    async (plan: Array<{ from: string; to: string; kind: "file" | "folder" }>) => {
      let copied = 0;
      try {
        await flush(); // the open note's latest edits come too
        for (const p of plan) {
          if (p.kind === "folder") {
            await store.createFolder(p.to);
            continue;
          }
          if (isBinary(p.from)) {
            const bytes = await store.readBinary(p.from);
            if (!bytes) continue;
            await store.writeBinary(p.to, bytes);
            indexes.addFile(p.to);
          } else {
            const file = await store.read(p.from);
            if (!file) continue;
            await store.write(p.to, file.content);
            indexes.set(p.to, file.content);
          }
          copied++;
        }
      } catch (e) {
        fail(e);
      }
      bumpIndex();
      await refresh();
      changed();
      return copied;
    },
    [flush, store, indexes, bumpIndex, refresh, changed, fail],
  );

  const setProperty = useCallback(
    async (path: string, key: string, value: unknown) => {
      if (!isNote(path) && !isDrawing(path) && !isCanvas(path)) return setFileProperty(path, key, value);
      await flush();
      const file = await store.read(path);
      if (!file) return;
      const next = setPropertyIn(path, file.content, key, value);
      if (next !== "unchanged") await writeNote(path, next);
    },
    [setFileProperty, flush, store, writeNote],
  );

  const reload = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const list = await store.list();
      if (paths.includes(SETTINGS_PATH)) setSettings(parseSettings((await store.read(SETTINGS_PATH))?.content));
      const propsChanged = paths.includes(PROPERTIES_PATH);
      const present = new Set(list.map((e) => e.path));
      for (const path of paths) {
        if (!present.has(path)) indexes.remove(path);
        else if (isBinary(path)) indexes.addFile(path);
        else {
          const f = await store.read(path);
          if (f) indexes.set(path, f.content);
        }
      }
      // Re-indexing an attachment drops its properties: put them back (or the new ones).
      applyFileProps(propsChanged ? parseFileProperties((await store.read(PROPERTIES_PATH))?.content) : filePropsRef.current);
      setEntries(list);
      bumpIndex();
      const current = activePath.current;
      if (!current) {
        // An empty vault just received its first notes: open one. (If notes were
        // already there, nothing is open because the user closed every tab.)
        const notes = list.filter((e) => e.kind === "file" && isNote(e.path));
        if (notes.length > 0 && notes.every((n) => paths.includes(n.path))) await open(notes[0].path);
        return;
      }
      if (!paths.includes(current)) return;
      if (!list.some((e) => e.path === current)) {
        pending.current = null;
        await open(null);
      } else if (!pending.current) {
        // Reopen to show the new content. With unsaved edits we leave it: sync
        // deferred this file and will merge on its next pass.
        await open(current);
      }
    },
    [store, indexes, bumpIndex, open, applyFileProps],
  );

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Other windows and tabs with this repository open: tell them what changed here, and
  // re-read what they changed, as after a sync.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !store.onChange) return;
    const channel = new BroadcastChannel(`noted-ai:vault:${vaultId}`);
    let batch = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = store.onChange((paths) => {
      for (const p of paths) batch.add(p);
      timer ??= setTimeout(() => {
        channel.postMessage({ paths: [...batch] });
        batch = new Set();
        timer = undefined;
      }, 50);
    });
    channel.onmessage = (e: MessageEvent<{ paths?: unknown }>) => {
      const paths = e.data?.paths;
      if (Array.isArray(paths)) void reloadRef.current(paths.filter((p): p is string => typeof p === "string"));
    };
    return () => {
      stop();
      if (timer) clearTimeout(timer);
      channel.close();
    };
  }, [store, vaultId]);

  // Another tab runs a different version of the app and holds the database.
  useEffect(
    () =>
      store.onUpgrade?.((waiting) =>
        setError(
          waiting === "blocked"
            ? "Cognotive.ai was updated. Close its other tabs and windows to finish, and this one will carry on."
            : waiting === "outdated"
              ? "Cognotive.ai was updated in another tab. Reload this one to keep working."
              : null,
        ),
      ),
    [store],
  );

  const api = useMemo<VaultApi>(
    () => ({
      ready,
      vaultId,
      entries,
      index,
      links,
      indexVersion,
      indexed,
      active,
      activeText,
      textOf,
      saveState,
      error,
      clearError,
      open,
      edit,
      flush,
      changeCounter,
      reload,
      createNote,
      createFolder,
      rename,
      move,
      remove,
      writeNote,
      writeFile,
      copyFiles,
      exportZip,
      importFiles,
      settings,
      updateSettings,
      fileProperties,
      setFileProperty,
      setProperty,
      createNoteWith,
      createDrawing,
      createCanvas,
      addAttachments,
      fileUrl,
      exists,
    }),
    [
      ready,
      vaultId,
      entries,
      index,
      links,
      indexVersion,
      indexed,
      active,
      activeText,
      textOf,
      saveState,
      error,
      clearError,
      open,
      edit,
      flush,
      changeCounter,
      reload,
      createNote,
      createFolder,
      rename,
      move,
      remove,
      writeNote,
      writeFile,
      copyFiles,
      exportZip,
      importFiles,
      settings,
      updateSettings,
      fileProperties,
      setFileProperty,
      setProperty,
      createNoteWith,
      createDrawing,
      createCanvas,
      addAttachments,
      fileUrl,
      exists,
    ],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}
