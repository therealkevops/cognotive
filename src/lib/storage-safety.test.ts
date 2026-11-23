import { describe, expect, it } from "vitest";
import { DAY, backupReminder, formatBytes, storageLimit, storageWarning, withLimit, withinLimit } from "./storage-safety";

const now = Date.UTC(2026, 10, 22);
const base = { local: true, now, lastChange: now - DAY, firstSeen: now - 30 * DAY, persisted: true, safari: false, installed: false };

describe("backupReminder", () => {
  it("reminds a local repository that changed since a backup long ago", () => {
    expect(backupReminder(base)).toBe("backup");
    expect(backupReminder({ ...base, lastBackup: now - 20 * DAY })).toBe("backup");
  });
  it("stays quiet when recently backed up, unchanged, new, synced or snoozed", () => {
    expect(backupReminder({ ...base, lastBackup: now - 2 * DAY })).toBeNull();
    expect(backupReminder({ ...base, lastBackup: now - 20 * DAY, lastChange: now - 21 * DAY })).toBeNull();
    expect(backupReminder({ ...base, firstSeen: now - 3 * DAY })).toBeNull();
    expect(backupReminder({ ...base, local: false })).toBeNull();
    expect(backupReminder({ ...base, snoozedUntil: now + DAY })).toBeNull();
  });
  it("warns straight away in Safari when the notes could be cleared", () => {
    const safari = { ...base, firstSeen: now, lastChange: now, safari: true, persisted: false };
    expect(backupReminder(safari)).toBe("safari");
    expect(backupReminder({ ...safari, installed: true })).toBeNull();
    expect(backupReminder({ ...safari, persisted: true })).toBeNull();
  });
});

describe("formatBytes", () => {
  it("reads naturally", () => {
    expect(formatBytes(300)).toBe("1 KB");
    expect(formatBytes(5.25 * 1024 * 1024)).toBe("5.3 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });
});

describe("storageWarning", () => {
  const now = 1_000_000;
  it("warns past 80% of what the browser allows, unless put off", () => {
    expect(storageWarning({ supported: true, persisted: false, usage: 85, quota: 100 }, now)).toBeCloseTo(0.85);
    expect(storageWarning({ supported: true, persisted: false, usage: 79, quota: 100 }, now)).toBeNull();
    expect(storageWarning({ supported: true, persisted: false, usage: 95, quota: 100 }, now, now + 1)).toBeNull();
    expect(storageWarning({ supported: true, persisted: false, usage: 95, quota: 100 }, now, now - 1)).toBeCloseTo(0.95);
  });
  it("says nothing when the browser doesn't tell", () => {
    expect(storageWarning({ supported: false, persisted: false }, now)).toBeNull();
  });
});

describe("a storage limit the user sets", () => {
  const MB = 1024 * 1024;
  it("is kept per browser, and only a positive number counts", () => {
    localStorage.clear();
    expect(storageLimit.get()).toBeNull();
    storageLimit.set(500 * MB);
    expect(storageLimit.get()).toBe(500 * MB);
    storageLimit.set(null);
    expect(storageLimit.get()).toBeNull();
    localStorage.setItem("noted-ai:storageLimit", JSON.stringify(-3));
    expect(storageLimit.get()).toBeNull();
  });

  it("replaces the browser's quota when it's lower", () => {
    const s = { supported: true, persisted: true, usage: 450 * MB, quota: 2000 * MB };
    expect(withLimit(s, 500 * MB)).toEqual({ ...s, quota: 500 * MB, limited: true });
    expect(withLimit(s, 5000 * MB)).toEqual({ ...s, limited: false });
    expect(withLimit(s, null)).toEqual({ ...s, limited: false });
    // And the warning follows it: 450 of 500 is 90%.
    expect(storageWarning(withLimit(s, 500 * MB), 0)).toBeCloseTo(0.9);
  });

  it("says whether more fits", () => {
    expect(withinLimit(450 * MB, 500 * MB, 40 * MB)).toBe(true);
    expect(withinLimit(450 * MB, 500 * MB, 60 * MB)).toBe(false);
    expect(withinLimit(450 * MB, null, 9000 * MB)).toBe(true);
    expect(withinLimit(undefined, 500 * MB, 9000 * MB)).toBe(true);
  });
});
