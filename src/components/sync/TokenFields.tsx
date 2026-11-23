"use client";

import { ExternalLink, KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NEW_TOKEN_URL } from "@/lib/github/token-store";
import { useSync } from "./useSync";

/** How to make a fine-grained token for Cognotive.ai. */
export function TokenInstructions({ repo }: { repo?: string }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted">
      <li>
        Open{" "}
        <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline hover:text-accent">
          GitHub&apos;s new token page <ExternalLink size={11} aria-hidden />
        </a>
        .
      </li>
      <li>
        Name it <strong>Cognotive.ai</strong> and pick an expiry. 90 days is a good balance; Cognotive.ai reminds you before it
        runs out.
      </li>
      <li>
        Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick{" "}
        {repo ? <strong>{repo}</strong> : "your notes repository"}. A new, empty private repository is fine.
      </li>
      <li>
        Under <strong>Permissions</strong>, add <strong>Contents</strong> and set it to <strong>Read and write</strong>.
        Nothing else is needed.
      </li>
      <li>Generate the token, copy it, and paste it here. It&apos;s saved only in this browser.</li>
    </ol>
  );
}

/** Asks for a new token for the open repository (none on this device yet, or GitHub stopped accepting it). */
export function TokenDialog({ reason, repo, onClose }: { reason: "missing" | "rejected"; repo: string; onClose(): void }) {
  const { setToken } = useSync();
  const [token, setTokenText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!setToken) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="GitHub token"
        className="dialog-panel relative max-w-lg space-y-4 p-6"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!token.trim() || busy) return;
          setBusy(true);
          setError(null);
          setToken(token)
            .then(onClose)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false));
        }}
      >
        <button type="button" className="icon-button absolute top-3 right-3" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
        <h2 className="flex items-center gap-2 font-serif text-2xl">
          <KeyRound size={20} aria-hidden /> GitHub token
        </h2>
        <p className="text-sm text-muted">
          {reason === "rejected"
            ? `GitHub no longer accepts the token for ${repo}; it may have expired or been revoked. Paste a new one to carry on syncing.`
            : `This device needs a GitHub token to sync ${repo}. Your notes here stay as they are meanwhile.`}
        </p>
        <TokenInstructions repo={repo} />
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Token</span>
          <input
            className="input font-mono"
            type="password"
            autoComplete="off"
            placeholder="github_pat_…"
            value={token}
            autoFocus
            onChange={(e) => setTokenText(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!token.trim() || busy}>
            {busy ? "Checking…" : "Save token"}
          </button>
        </div>
      </form>
    </div>
  );
}
