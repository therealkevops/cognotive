import { readPref, writePref } from "./prefs";

/**
 * A sentence for the workspace to show above the editor (the result of a merge, say), from
 * anywhere in the app: now, or, for an action that reloads the workspace by opening another
 * repository, once it next opens.
 */
const NOTICE_EVENT = "noted-notice";

export function showNotice(text: string) {
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));
}

/** Kept in this browser and shown the next time the workspace opens. */
export function leaveNotice(text: string) {
  writePref("importNotice", text);
}

/** The notice left for this opening, if any (shown once). */
export function takeLeftNotice(): string | null {
  const left = readPref<string | null>("importNotice", null);
  if (left) writePref("importNotice", null);
  return left;
}

/** Calls `show` with each notice sent while subscribed; returns the unsubscribe. */
export function onNotice(show: (text: string) => void): () => void {
  const listener = (e: Event) => show((e as CustomEvent<string>).detail);
  window.addEventListener(NOTICE_EVENT, listener);
  return () => window.removeEventListener(NOTICE_EVENT, listener);
}
