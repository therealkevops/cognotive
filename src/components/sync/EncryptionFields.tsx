"use client";

import { Check, Copy, Download, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSync } from "./useSync";

export type SecretKind = "passphrase" | "recovery key";

/** Passphrase field, with a switch to enter the recovery key instead. */
export function UnlockFields({
  kind,
  setKind,
  secret,
  setSecret,
  autoFocus,
}: {
  kind: SecretKind;
  setKind(k: SecretKind): void;
  secret: string;
  setSecret(s: string): void;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">{kind === "passphrase" ? "Passphrase" : "Recovery key"}</span>
        <input
          className="input font-mono"
          type={kind === "passphrase" ? "password" : "text"}
          autoComplete={kind === "passphrase" ? "current-password" : "off"}
          spellCheck={false}
          placeholder={kind === "recovery key" ? "xxxx-xxxx-xxxx-…" : undefined}
          value={secret}
          autoFocus={autoFocus}
          onChange={(e) => setSecret(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="text-xs text-muted underline hover:text-accent"
        onClick={() => {
          setKind(kind === "passphrase" ? "recovery key" : "passphrase");
          setSecret("");
        }}
      >
        {kind === "passphrase" ? "Use the recovery key instead" : "Use the passphrase instead"}
      </button>
    </div>
  );
}

/** The shortest passphrase accepted when turning encryption on. */
export const MIN_PASSPHRASE = 10;

/** New passphrase and confirmation. Returns an error message, or null when they're fine. */
export function newPassphraseError(pass: string, confirm: string): string | null {
  if (pass.length < MIN_PASSPHRASE)
    return `Use at least ${MIN_PASSPHRASE} characters. A few unrelated words work well.`;
  if (confirm && pass !== confirm) return "The two passphrases don't match.";
  if (!confirm) return "Type it again to confirm.";
  return null;
}

/**
 * Shows the recovery key once, with copy and download, and waits for the user
 * to confirm they've saved it.
 */
export function RecoveryKeyStep({
  recoveryKey,
  repoLabel,
  onDone,
}: {
  recoveryKey: string;
  repoLabel: string;
  onDone(): void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const download = () => {
    const text = `Cognotive.ai recovery key for ${repoLabel}\n\n${recoveryKey}\n\nThis key unlocks the encrypted notes if the passphrase is forgotten. Keep it somewhere safe and private.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Cognotive.ai recovery key (${repoLabel.replace("/", " ")}).txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section aria-label="Recovery key" className="space-y-4 rounded-xl border border-border p-5">
      <h4 className="font-semibold tracking-tight text-lg">Save your recovery key</h4>
      <p className="text-sm text-muted">
        If you forget the passphrase, this key is the only way to read these notes again. Nobody else has a copy,
        including Cognotive.ai. Store it in a password manager or print it.
      </p>
      <p
        className="rounded-lg bg-surface px-4 py-3 text-center font-mono text-sm tracking-wide select-all"
        aria-label="Recovery key value"
      >
        {recoveryKey}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="button-secondary"
          onClick={() => void navigator.clipboard.writeText(recoveryKey).then(() => setCopied(true))}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="button-secondary" onClick={download}>
          <Download size={14} aria-hidden /> Download
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I&apos;ve saved my recovery key somewhere safe
      </label>
      <div className="flex justify-end">
        <button type="button" className="button-primary" disabled={!saved} onClick={onDone}>
          Open repository
        </button>
      </div>
    </section>
  );
}

/** Asks for the passphrase (or recovery key) of the open, locked repository. */
export function UnlockDialog({ onClose }: { onClose(): void }) {
  const { unlock } = useSync();
  const [kind, setKind] = useState<SecretKind>("passphrase");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!unlock) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Unlock repository"
        className="dialog-panel relative max-w-md space-y-4 p-6"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!secret.trim() || busy) return;
          setBusy(true);
          setError(null);
          unlock(secret, kind)
            .then(onClose)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false));
        }}
      >
        <button type="button" className="icon-button absolute top-3 right-3" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
        <h2 className="flex items-center gap-2 font-semibold tracking-tight text-2xl">
          <Lock size={20} aria-hidden /> Unlock
        </h2>
        <p className="text-sm text-muted">
          This repository is encrypted. Enter its passphrase to sync it on this device. Your notes here stay as they are
          meanwhile.
        </p>
        <UnlockFields kind={kind} setKind={setKind} secret={secret} setSecret={setSecret} autoFocus />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!secret.trim() || busy}>
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
