/**
 * Per-browser UI preferences in localStorage. Every access is guarded: storage
 * can be unavailable (private mode, blocked site data) and the app must still work.
 */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`noted-ai:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`noted-ai:${key}`, JSON.stringify(value));
  } catch {
    // Ignore: preferences are a convenience.
  }
}
