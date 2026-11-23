import { isStandalone } from "./install";
import { readPref, writePref } from "./prefs";

/**
 * Keeping notes safe in the browser. Browsers may clear a site's storage when
 * the disk runs low, and Safari after about a week without a visit, unless the
 * site's storage is marked persistent (or the app is installed). For a
 * repository that isn't synced, the browser holds the only copy.
 */
export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usage?: number;
  quota?: number;
}

export async function storageStatus(): Promise<StorageStatus> {
  const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!s?.persisted) return { supported: false, persisted: false };
  const [persisted, estimate] = await Promise.all([s.persisted().catch(() => false), s.estimate?.().catch(() => undefined)]);
  return { supported: true, persisted, ...(estimate ? { usage: estimate.usage, quota: estimate.quota } : {}) };
}

/** Asks the browser to keep this site's storage. Chrome and Safari decide quietly; Firefox asks the user. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Firefox shows a prompt for persist(), so it's only asked when the user chooses to. */
export const asksUser = () => typeof navigator !== "undefined" && /Firefox\//.test(navigator.userAgent);

/** Safari (not Chrome or Edge on Apple devices), which clears data of sites not visited for a week. */
export function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox/.test(ua);
}

export const DAY = 86_400_000;
export const BACKUP_EVERY_DAYS = 14;
export const SNOOZE_DAYS = 7;

export type Reminder = "safari" | "backup" | null;

/**
 * Whether to remind about backing up a repository kept only in this browser:
 * "safari" when Safari may clear it (not installed, not persistent), "backup"
 * when it has changed since the last backup (or first use) and that was a
 * while ago. Nothing for synced repositories, or while snoozed.
 */
export function backupReminder(r: {
  local: boolean;
  now: number;
  /** When notes last changed. */
  lastChange: number;
  lastBackup?: number;
  /** When this repository was first opened in this browser. */
  firstSeen: number;
  snoozedUntil?: number;
  persisted: boolean;
  safari: boolean;
  installed: boolean;
}): Reminder {
  if (!r.local || (r.snoozedUntil && r.now < r.snoozedUntil)) return null;
  if (r.safari && !r.installed && !r.persisted) return "safari";
  const since = r.lastBackup ?? r.firstSeen;
  if (r.lastChange > since && r.now - since > BACKUP_EVERY_DAYS * DAY) return "backup";
  return null;
}

/** Per repository, in this browser. */
const key = (vaultId: string, k: string) => `vault:${vaultId}:${k}`;
export const backupPrefs = {
  lastBackup: (id: string) => readPref<number | undefined>(key(id, "lastBackup"), undefined),
  markBackup: (id: string, at = Date.now()) => writePref(key(id, "lastBackup"), at),
  firstSeen(id: string, now = Date.now()): number {
    const v = readPref<number | undefined>(key(id, "firstSeen"), undefined);
    if (v) return v;
    writePref(key(id, "firstSeen"), now);
    return now;
  },
  snoozedUntil: (id: string) => readPref<number | undefined>(key(id, "backupSnooze"), undefined),
  snooze: (id: string, now = Date.now()) => writePref(key(id, "backupSnooze"), now + SNOOZE_DAYS * DAY),
};

/** Share of what the browser allows this site at which to warn that storage is nearly full. */
export const NEARLY_FULL = 0.8;

/**
 * How full this site's storage is (0 to 1) when it's worth a warning: past NEARLY_FULL and
 * not put off. Null when there's nothing to say, or the browser doesn't tell.
 */
export function storageWarning(s: StorageStatus, now: number, snoozedUntil?: number): number | null {
  if (!s.usage || !s.quota || (snoozedUntil && now < snoozedUntil)) return null;
  const share = s.usage / s.quota;
  return share >= NEARLY_FULL ? share : null;
}

/** A limit the user set for the app's storage on this device, in bytes (null: what the browser allows). */
export const storageLimit = {
  get(): number | null {
    const v = readPref<unknown>("storageLimit", null);
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  },
  set(bytes: number | null) {
    writePref("storageLimit", bytes);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STORAGE_LIMIT_EVENT));
  },
};
/** Sent on `window` when the limit changes, so warnings can look again. */
export const STORAGE_LIMIT_EVENT = "noted-storage-limit";

/**
 * The status measured against the user's limit when they set one below what the browser
 * allows (`limited` says which it is): warnings and the Storage summary use this quota.
 */
export function withLimit(s: StorageStatus, limit: number | null): StorageStatus & { limited: boolean } {
  if (!limit || (s.quota && s.quota <= limit)) return { ...s, limited: false };
  return { ...s, quota: limit, limited: true };
}

/** Whether `adding` more bytes keeps usage within the limit (true without a limit, or a usage figure). */
export function withinLimit(usage: number | undefined, limit: number | null, adding: number): boolean {
  return !limit || usage === undefined || usage + adding <= limit;
}

/** For this browser (storage is per site, not per repository). */
export const storagePrefs = {
  snoozedUntil: () => readPref<number | undefined>("storageFullSnooze", undefined),
  snooze: (now = Date.now()) => writePref("storageFullSnooze", now + DAY),
};

export { isStandalone };

export function formatBytes(n: number): string {
  if (n <= 0) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
