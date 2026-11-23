"use client";

import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, storagePrefs, storageStatus, storageWarning, type StorageStatus } from "@/lib/storage-safety";
import { useVault } from "../vault/useVault";

/**
 * A warning when this site's storage passes 80% of what the browser allows: the browser
 * may then refuse new notes or images, or (in some) clear what's stored. Checked when the
 * app opens and as files change; "Later" puts it off for a day.
 */
export function StorageBanner({ onOpenStorage }: { onOpenStorage(): void }) {
  const vault = useVault();
  const [warn, setWarn] = useState<{ share: number; status: StorageStatus } | null>(null);
  const [tick, setTick] = useState(0);
  const lastChange = vault.entries.reduce((m, e) => Math.max(m, e.mtime), 0);

  useEffect(() => {
    if (!vault.ready) return;
    let live = true;
    void storageStatus().then((s) => {
      if (!live) return;
      const share = storageWarning(s, Date.now(), storagePrefs.snoozedUntil());
      setWarn(share === null ? null : { share, status: s });
    });
    return () => {
      live = false;
    };
  }, [vault.ready, lastChange, tick]);

  if (!warn) return null;
  const { share, status } = warn;
  return (
    <div role="region" aria-label="Storage nearly full" className="mx-3 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[#d9772b]/40 bg-[#d9772b]/10 px-3 py-2 text-sm">
      <HardDrive size={16} aria-hidden className="shrink-0 text-[#d9772b]" />
      <p className="min-w-0 flex-1">
        Storage is {Math.round(share * 100)}% full ({formatBytes(status.usage!)} of {formatBytes(status.quota!)} this browser allows). Delete
        unused attachments or the search model to make room.
      </p>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" className="button-primary px-2.5 py-1 text-xs" onClick={onOpenStorage}>
          Free up space
        </button>
        <button
          type="button"
          className="button-secondary px-2.5 py-1 text-xs text-muted"
          onClick={() => {
            storagePrefs.snooze();
            setTick((t) => t + 1);
          }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
