import { DEFAULT_SETTINGS, SETTINGS_PATH, type VaultSettings } from "../vault/settings";
import { normalizePath } from "../vault/paths";

/*
 * Importing an Obsidian vault from a folder on this computer: which of its files become the
 * repository's, and which of Obsidian's settings carry over.
 */

/** A file picked from a folder, with its path inside it ("Vault/Notes/Plan.md"). */
export interface PickedFile<F = File> {
  relativePath: string;
  file: F;
}

export interface VaultFolder<F = File> {
  /** The picked folder's name: the vault's. */
  name: string;
  /** Its files, by path inside the vault. */
  files: Array<{ path: string; file: F }>;
  /** Obsidian's own settings files (".obsidian/…"), by name ("app.json"). */
  config: Map<string, F>;
}

/** Folders and files that are Obsidian's, the system's or version control's, not notes. */
const SKIP = new Set([".obsidian", ".trash", ".git", ".github", ".DS_Store", "Thumbs.db", "desktop.ini", "node_modules"]);

/**
 * The files of a picked vault folder: the folder's own name dropped from their paths, and
 * hidden or system ones (".obsidian", ".trash", ".git"…) left out; Obsidian's settings
 * files are kept aside to read.
 */
export function vaultFolder<F>(picked: Array<PickedFile<F>>): VaultFolder<F> {
  const name = picked[0]?.relativePath.split("/")[0] ?? "";
  const files: Array<{ path: string; file: F }> = [];
  const config = new Map<string, F>();
  for (const p of picked) {
    const parts = p.relativePath.split("/");
    const inside = parts.length > 1 && parts[0] === name ? parts.slice(1) : parts;
    if (inside[0] === ".obsidian" && inside.length === 2 && inside[1].endsWith(".json")) {
      config.set(inside[1], p.file);
      continue;
    }
    if (inside.some((seg) => SKIP.has(seg) || seg.startsWith("."))) continue;
    try {
      const path = normalizePath(inside.join("/"));
      if (path) files.push({ path, file: p.file });
    } catch {
      // A path the repository can't hold: left out.
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name, files, config };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** A vault folder path as Obsidian writes it ("/Attachments/", "./") as a repository folder, or null. */
const folder = (v: unknown): string | null => {
  const s = str(v);
  if (!s || s === "/" || s.startsWith("./") || s === ".") return null;
  try {
    return normalizePath(s.replace(/^\/+|\/+$/g, "")) || null;
  } catch {
    return null;
  }
};
const note = (v: unknown) => {
  const s = str(v);
  return s ? s.replace(/^\/+/, "").replace(/(\.md)?$/i, ".md") : "";
};

/**
 * The repository settings that follow from Obsidian's (.obsidian/app.json, daily-notes.json
 * and templates.json, already parsed). Only what Obsidian set, and this app can do, is
 * returned: attachments in a note's own folder ("./"), for example, have no match here.
 */
export function obsidianSettings(config: { app?: unknown; daily?: unknown; templates?: unknown }): Partial<VaultSettings> {
  const out: Partial<VaultSettings> = {};
  const app = (config.app && typeof config.app === "object" ? config.app : {}) as Record<string, unknown>;
  const daily = (config.daily && typeof config.daily === "object" ? config.daily : {}) as Record<string, unknown>;
  const templates = (config.templates && typeof config.templates === "object" ? config.templates : {}) as Record<string, unknown>;

  const attachments = folder(app.attachmentFolderPath);
  if (attachments) out.attachmentFolder = attachments;
  if (app.useMarkdownLinks === true) out.linkFormat = "markdown";
  if (app.newFileLocation === "root") out.newNoteLocation = "root";
  else if (app.newFileLocation === "current") out.newNoteLocation = "current";
  else if (app.newFileLocation === "folder") {
    const f = folder(app.newFileFolderPath);
    if (f) {
      out.newNoteLocation = "folder";
      out.newNoteFolder = f;
    }
  }

  if ("folder" in daily) out.dailyFolder = folder(daily.folder) ?? "";
  if (str(daily.format)) out.dailyFormat = str(daily.format);
  if (str(daily.template)) out.dailyTemplate = note(daily.template);

  const t = folder(templates.folder);
  if (t) out.templateFolder = t;
  return out;
}

/** The settings file for a new repository: the defaults, with Obsidian's on top. */
export function settingsFile(from: Partial<VaultSettings>): string {
  return `${JSON.stringify({ ...DEFAULT_SETTINGS, ...from }, null, 2)}\n`;
}

/** Where the files go: a repository's store (a new one, before it's opened). */
interface Target {
  write(path: string, content: string): Promise<unknown>;
  writeBinary(path: string, bytes: Uint8Array): Promise<unknown>;
}

/**
 * Writes a vault's files into a repository's store as they are (images aren't made smaller:
 * notes link to them by name), reading one at a time, then its settings file. For a new
 * repository, before it's opened: it then opens with these files rather than a welcome note.
 */
export async function importInto(
  store: Target,
  files: Array<{ path: string; file: Blob }>,
  settings: string,
  isBinary: (path: string) => boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let done = 0;
  for (const f of files) {
    onProgress?.(done, files.length);
    if (isBinary(f.path)) await store.writeBinary(f.path, new Uint8Array(await f.file.arrayBuffer()));
    else await store.write(f.path, await f.file.text());
    done++;
  }
  await store.write(SETTINGS_PATH, settings);
  onProgress?.(done, files.length);
  return done;
}
