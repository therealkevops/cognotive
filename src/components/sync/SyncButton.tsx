"use client";

import { CloudAlert, CloudCheck, CloudOff, CloudUpload, Lock, LogIn, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { UnlockDialog } from "./EncryptionFields";
import { useSync } from "./useSync";

function ago(ts: number | null): string {
  if (!ts) return "not yet";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Sync state for a GitHub vault; click to sync now (or sign in). */
export function SyncButton() {
  const { status, syncNow } = useSync();
  const auth = useAuth();
  const [unlocking, setUnlocking] = useState(false);
  if (status.kind === "local") return null;

  let icon = <CloudCheck size={16} aria-hidden />;
  let label = "Synced";
  let title = "";
  let tone = "text-muted";
  let onClick = syncNow;

  switch (status.kind) {
    case "idle":
      if (status.pending > 0) {
        icon = <CloudUpload size={16} aria-hidden />;
        label = `${status.pending} unsynced`;
        title = `${status.pending} local ${status.pending === 1 ? "change" : "changes"} not yet on GitHub. Click to sync now.`;
      } else {
        title = `Up to date with GitHub (synced ${ago(status.lastSyncedAt)}). Click to sync now.`;
      }
      break;
    case "syncing":
      icon = <RefreshCw size={16} aria-hidden className="animate-spin" />;
      label = "Syncing…";
      title = "Syncing with GitHub";
      break;
    case "signed_out":
      icon = <LogIn size={16} aria-hidden />;
      label = "Sign in to sync";
      title = "Sign in with GitHub to sync this repository. Your edits are kept in this browser meanwhile.";
      tone = "text-accent";
      onClick = auth.signIn;
      break;
    case "locked":
      icon = <Lock size={16} aria-hidden />;
      label = "Locked";
      title = "This repository is encrypted. Enter its passphrase to sync it on this device.";
      tone = "text-accent";
      onClick = () => setUnlocking(true);
      break;
    case "offline":
      icon = <CloudOff size={16} aria-hidden />;
      label = "Offline";
      title = `Offline. ${status.pending} ${status.pending === 1 ? "change waits" : "changes wait"} in this browser and will sync when you're back online.`;
      break;
    case "error":
      icon = <CloudAlert size={16} aria-hidden />;
      label = "Sync failed";
      title = `${status.message} Click to retry.`;
      tone = "text-red-600 dark:text-red-400";
      break;
  }

  return (
    <>
      {unlocking && <UnlockDialog onClose={() => setUnlocking(false)} />}
      <button
        type="button"
        onClick={onClick}
        disabled={status.kind === "syncing"}
        title={title}
        aria-label={`${label}. ${title}`}
        className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-foreground/5 ${tone}`}
      >
        {icon}
        <span className="hidden sm:inline" aria-hidden>
          {label}
        </span>
      </button>
    </>
  );
}
