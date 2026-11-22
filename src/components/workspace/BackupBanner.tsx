"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { backupPrefs, backupReminder, isSafari, isStandalone, storageStatus, type Reminder } from "@/lib/storage-safety";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";

/**
 * A reminder, for a repository kept only in this browser, to back it up (or
 * connect GitHub): when it has changed since a backup a while ago, or straight
 * away in Safari, which may clear it after a week without a visit.
 */
export function BackupBanner({ onExport, onConnect }: { onExport(): Promise<void>; onConnect(): void }) {
  const vault = useVault();
  const { active } = useVaults();
  const [reminder, setReminder] = useState<Reminder>(null);
  const [tick, setTick] = useState(0);
  const local = active.kind === "local";
  const lastChange = vault.entries.reduce((m, e) => Math.max(m, e.mtime), 0);

  useEffect(() => {
    if (!local || !vault.ready) return;
    let live = true;
    void storageStatus().then((s) => {
      if (!live) return;
      setReminder(
        backupReminder({
          local,
          now: Date.now(),
          lastChange,
          lastBackup: backupPrefs.lastBackup(vault.vaultId),
          firstSeen: backupPrefs.firstSeen(vault.vaultId),
          snoozedUntil: backupPrefs.snoozedUntil(vault.vaultId),
          persisted: s.persisted,
          safari: isSafari(),
          installed: isStandalone(),
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [local, vault.ready, vault.vaultId, lastChange, tick]);

  if (!local || !reminder) return null;
  return (
    <div role="region" aria-label="Back up your notes" className="mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[#d9772b]/40 bg-[#d9772b]/10 px-3 py-2 text-sm">
      <ShieldAlert size={16} aria-hidden className="shrink-0 text-[#d9772b]" />
      <p className="min-w-0 flex-1">
        {reminder === "safari"
          ? "These notes are only in this browser, and Safari may delete a site's data after a week without a visit. Install the app (Share, then Add to Home Screen), connect GitHub, or export a backup."
          : "These notes are only in this browser, and they've changed since your last backup. Export a copy, or connect GitHub to keep them synced."}
      </p>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          className="button-primary px-2.5 py-1 text-xs"
          onClick={async () => {
            await onExport();
            setTick((t) => t + 1);
          }}
        >
          Export backup
        </button>
        <button type="button" className="button-secondary px-2.5 py-1 text-xs" onClick={onConnect}>
          Connect GitHub
        </button>
        <button
          type="button"
          className="button-secondary px-2.5 py-1 text-xs text-muted"
          onClick={() => {
            backupPrefs.snooze(vault.vaultId);
            setTick((t) => t + 1);
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
