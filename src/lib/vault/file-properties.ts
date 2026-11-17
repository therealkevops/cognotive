/**
 * Properties of attachments (images, PDFs, audio, video), which can't hold
 * them inside the file. They live in one file in the repository, keyed by
 * path, so they sync and follow renames.
 */
export const PROPERTIES_PATH = ".noted/properties.json";

export type FileProperties = Record<string, Record<string, unknown>>;

export function parseFileProperties(text: string | undefined): FileProperties {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: FileProperties = {};
    for (const [path, props] of Object.entries(raw as Record<string, unknown>)) {
      if (props && typeof props === "object" && !Array.isArray(props) && Object.keys(props).length) {
        out[path] = props as Record<string, unknown>;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Sorted by path, so the file changes as little as possible between edits. */
export function serializeFileProperties(all: FileProperties): string {
  const sorted = Object.fromEntries(Object.keys(all).sort().map((p) => [p, all[p]]));
  return JSON.stringify(sorted, null, 2) + "\n";
}

/** Sets (or, with undefined, removes) one property of a file. */
export function withFileProperty(all: FileProperties, path: string, key: string, value: unknown): FileProperties {
  const props = { ...(all[path] ?? {}) };
  if (value === undefined) delete props[key];
  else props[key] = value;
  const next = { ...all };
  if (Object.keys(props).length) next[path] = props;
  else delete next[path];
  return next;
}

/** After files moved (old path → new path): their properties follow. Null if nothing changed. */
export function movedFileProperties(all: FileProperties, moves: Iterable<[string, string]>): FileProperties | null {
  let next: FileProperties | null = null;
  for (const [from, to] of moves) {
    if (!(from in all) || from === to) continue;
    next ??= { ...all };
    next[to] = next[from];
    delete next[from];
  }
  return next;
}

/** After files were deleted: their properties go too. Null if nothing changed. */
export function withoutFileProperties(all: FileProperties, removed: Iterable<string>): FileProperties | null {
  let next: FileProperties | null = null;
  for (const p of removed) {
    if (!(p in all)) continue;
    next ??= { ...all };
    delete next[p];
  }
  return next;
}
