import { describe, expect, it } from "vitest";
import { backupReminder, DAY, formatBytes } from "./storage-safety";

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
