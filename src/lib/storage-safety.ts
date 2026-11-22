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

export { isStandalone };

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
