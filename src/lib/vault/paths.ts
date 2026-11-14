/**
 * Vault paths are POSIX-style, relative to the vault root, with no leading or
 * trailing slash: "Projects/Plan.md". Folders are implied by the files in them,
 * except for empty folders, which stores record explicitly.
 */

const INVALID_CHARS = /[\\:*?"<>|#^[\]]/;

/** Collapse slashes, trim whitespace around segments, drop "." segments. Rejects "..". */
export function normalizePath(path: string): string {
  const parts = path
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error(`Path may not contain "..": ${path}`);
  return parts.join("/");
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

export function isMarkdown(path: string): boolean {
  return extname(path) === ".md";
}

/** The note title shown in the UI: the file name without ".md". */
export function noteTitle(path: string): string {
  const name = basename(path);
  return isMarkdown(name) ? name.slice(0, -3) : name;
}

/** Returns an error message if a single file or folder name is not allowed, else null. */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name can't be empty.";
  if (trimmed.includes("/")) return 'Name can\'t contain "/".';
  if (trimmed.startsWith(".")) return 'Name can\'t start with ".".';
  if (INVALID_CHARS.test(trimmed)) return 'Name can\'t contain any of \\ : * ? " < > | # ^ [ ]';
  return null;
}

/** True if `path` is `folder` itself or inside it. */
export function isWithin(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(folder + "/");
}

/**
 * Returns `desired` if it isn't taken, otherwise "Name 1.md", "Name 2.md", ...
 * in the same folder.
 */
export function uniquePath(desired: string, taken: (path: string) => boolean): string {
  if (!taken(desired)) return desired;
  const dir = dirname(desired);
  const ext = extname(desired);
  const stem = basename(desired).slice(0, basename(desired).length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = joinPath(dir, `${stem} ${n}${ext}`);
    if (!taken(candidate)) return candidate;
  }
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/** Files stored as bytes rather than text: images, PDFs, audio and video. */
export function isBinary(path: string): boolean {
  return extname(path) in MIME;
}

export function isImage(path: string): boolean {
  return mimeType(path).startsWith("image/");
}

export function isDrawing(path: string): boolean {
  return path.toLowerCase().endsWith(".excalidraw");
}

export function mimeType(path: string): string {
  return MIME[extname(path)] ?? "application/octet-stream";
}

/** The file extension to use for a pasted or dropped file of this MIME type. */
export function extensionFor(mime: string): string | null {
  const hit = Object.entries(MIME).find(([, m]) => m === mime);
  return hit ? hit[0] : null;
}
