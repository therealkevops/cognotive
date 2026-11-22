import { mergeText } from "../sync/engine";
import { isNote } from "./paths";

export interface SaveDecision {
  /** What to save in the file. */
  text: string;
  /** The other window's version, kept as a copy when the two can't be merged. */
  copy?: { path: string; content: string };
}

/** "Plan.md" → "Plan (from another window).md", numbered if that's taken too. */
export function otherWindowCopyPath(path: string, exists: (p: string) => boolean): string {
  const m = /(\.excalidraw\.md|\.[^./]+)$/i.exec(path);
  const ext = m ? m[1] : "";
  const stem = path.slice(0, path.length - ext.length);
  let candidate = `${stem} (from another window)${ext}`;
  for (let i = 2; exists(candidate); i++) candidate = `${stem} (from another window ${i})${ext}`;
  return candidate;
}

/**
 * Saving `ours` (this window's edit of a file it loaded as `base`) when the file may have
 * been changed meanwhile by another window, to `theirs`. Changes in different places are
 * merged; if both changed the same lines (or the file isn't a note), this window's version
 * is saved and the other is kept as a copy, so nothing is lost.
 */
export function decideSave(path: string, ours: string, base: string, theirs: string | undefined, exists: (p: string) => boolean): SaveDecision {
  if (theirs === undefined || theirs === base || theirs === ours) return { text: ours };
  const merged = isNote(path) ? mergeText(ours, base, theirs) : null;
  if (merged !== null) return { text: merged };
  return { text: ours, copy: { path: otherWindowCopyPath(path, exists), content: theirs } };
}
