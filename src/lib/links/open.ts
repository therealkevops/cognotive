/** Where to open a followed link. */
export type OpenHow = "here" | "tab" | "side";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Ctrl on Windows and Linux, Cmd on a Mac. */
export function hasModKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/**
 * Ctrl/Cmd+Alt+click opens in the side pane; Ctrl/Cmd+click or a middle
 * click opens a new tab; a plain click opens the link in the current tab.
 */
export function openHow(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; button?: number }): OpenHow {
  const mod = hasModKey(e);
  if (mod && e.altKey) return "side";
  if (mod || e.button === 1) return "tab";
  return "here";
}
