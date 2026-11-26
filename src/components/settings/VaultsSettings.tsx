"use client";

import { FolderGit2, HardDrive, Lock } from "lucide-react";
import { useState } from "react";
import { forgetKeys } from "@/lib/crypto/key-store";
import { saveToken } from "@/lib/github/token-store";
import { verifyToken } from "@/lib/github/verify-token";
import { DEFAULT_IDLE_SECONDS, describeVault, newVaultId, type GitHubVaultConfig, type SyncMode, type VaultConfig } from "@/lib/vault/registry";
import { TokenInstructions } from "../sync/TokenFields";
import { SectionHeader } from "./parts";
import { useVaults } from "../vault/useVaults";
import { ConnectRepoForm } from "./ConnectRepoForm";
import { MergeVault } from "./MergeVault";
import { Field, StarterTemplatesOption, SyncFields } from "./repo-fields";

/* Repositories, sync and storage. */

export function VaultsSection() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <SectionHeader title="Repositories & sync" description="Each repository is a separate set of notes, kept in this browser or synced with GitHub." />
      <VaultList />
      <div className="mt-4">
        {adding ? <ConnectRepoForm onDone={() => setAdding(false)} /> : <AddButtons onGitHub={() => setAdding(true)} />}
      </div>
    </>
  );
}

export function VaultList() {
  const { vaults, active, switchTo, remove, update } = useVaults();
  const [editing, setEditing] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  return (
    <section aria-label="Repositories">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {vaults.map((v) => (
          <li key={v.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
                {v.kind === "github" ? <FolderGit2 size={18} aria-hidden /> : <HardDrive size={18} aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {v.name}
                  {v.id === active.id && (
                    <span className="rounded-full bg-accent/12 px-2 py-px text-[0.6875rem] font-medium text-accent">Open</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">{describeVault(v)}</p>
              </div>
              {v.id !== active.id && (
                <button type="button" className="button-secondary" onClick={() => switchTo(v.id)}>
                  Open
                </button>
              )}
              {vaults.length > 1 && (
                <button
                  type="button"
                  className="button-secondary"
                  aria-expanded={merging === v.id}
                  aria-label={`Merge ${v.name} into another repository`}
                  onClick={() => {
                    setEditing(null);
                    setMerging(merging === v.id ? null : v.id);
                  }}
                >
                  Merge into…
                </button>
              )}
              <button
                type="button"
                className="button-secondary"
                aria-expanded={editing === v.id}
                onClick={() => {
                  setMerging(null);
                  setEditing(editing === v.id ? null : v.id);
                }}
              >
                Edit
              </button>
            </div>
            {merging === v.id && <MergeVault source={v} onDone={() => setMerging(null)} />}
            {editing === v.id && (
              <EditVault
                vault={v}
                canRemove={vaults.length > 1}
                onSave={(patch) => {
                  update(v.id, patch);
                  setEditing(null);
                }}
                onRemove={async () => {
                  const where =
                    v.kind === "github"
                      ? `Its notes stay in ${v.owner}/${v.repo}, but changes not yet synced will be lost.`
                      : "Its notes are only stored in this browser and will be deleted.";
                  if (window.confirm(`Remove “${v.name}” from this browser? ${where}`)) {
                    await remove(v.id);
                  }
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EditVault({
  vault,
  canRemove,
  onSave,
  onRemove,
}: {
  vault: VaultConfig;
  canRemove: boolean;
  onSave(patch: Partial<VaultConfig>): void;
  onRemove(): void;
}) {
  const [name, setName] = useState(vault.name);
  const [syncMode, setSyncMode] = useState<SyncMode>(vault.kind === "github" ? vault.syncMode : "auto");
  const [idle, setIdle] = useState(vault.kind === "github" ? vault.idleSeconds : DEFAULT_IDLE_SECONDS);
  return (
    <form
      className="mt-3 space-y-3 rounded-lg bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          vault.kind === "github"
            ? { name: name.trim() || vault.name, syncMode, idleSeconds: idle }
            : { name: name.trim() || vault.name },
        );
      }}
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {vault.kind === "github" && <SyncFields mode={syncMode} setMode={setSyncMode} idle={idle} setIdle={setIdle} />}
      {vault.kind === "github" && <ReplaceToken vault={vault} />}
      {vault.kind === "github" && vault.encrypted && (
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Lock size={14} aria-hidden /> Encrypted
            </span>
            This browser holds the key. Forget it to require the passphrase again here.
          </p>
          <button
            type="button"
            className="button-secondary shrink-0"
            onClick={() => {
              if (window.confirm("Forget the key on this device? Syncing stops until you enter the passphrase again.")) {
                void forgetKeys(vault.id).then(() => window.location.reload());
              }
            }}
          >
            Forget key
          </button>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <button
          type="button"
          className="rounded-lg px-2 text-sm text-red-700 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
          disabled={!canRemove}
          title={canRemove ? undefined : "Keep at least one repository"}
          onClick={onRemove}
        >
          Remove from this browser
        </button>
        <button type="submit" className="button-primary">
          Save
        </button>
      </div>
    </form>
  );
}

/** Swaps the GitHub token a repository syncs with on this device. */
export function ReplaceToken({ vault }: { vault: GitHubVaultConfig }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = `${vault.owner}/${vault.repo}`;
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          <span className="block text-sm font-medium text-foreground">GitHub token</span>
          Saved in this browser only.
        </p>
        {!open && (
          <button type="button" className="button-secondary shrink-0" onClick={() => setOpen(true)}>
            Replace token
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <TokenInstructions repo={label} />
          <div className="flex flex-wrap items-end gap-2">
            <input
              className="input min-w-0 flex-1 font-mono"
              type="password"
              autoComplete="off"
              aria-label="New GitHub token"
              placeholder="github_pat_…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className="button-primary"
              disabled={!text.trim() || busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                verifyToken(text, { owner: vault.owner, repo: vault.repo })
                  .then((t) => saveToken(vault.id, t))
                  .then(() => window.location.reload())
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Checking…" : "Save token"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function AddButtons({ onGitHub }: { onGitHub(): void }) {
  const { add } = useVaults();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("New repository");
  const [starters, setStarters] = useState(true);
  if (creating) {
    return (
      <form
        aria-label="New local repository"
        className="space-y-4 rounded-xl border border-border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          add({ id: newVaultId("local"), name: name.trim(), kind: "local", ...(starters ? { starterTemplates: true } : {}) });
        }}
      >
        <h4 className="font-semibold tracking-tight text-lg">New local repository</h4>
        <Field label="Name">
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <StarterTemplatesOption checked={starters} onChange={setStarters} />
        <div className="flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={() => setCreating(false)}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!name.trim()}>
            Create and open
          </button>
        </div>
      </form>
    );
  }
  return (
    <section aria-label="Add a repository" className="flex flex-wrap gap-2">
      <button type="button" className="button-primary" onClick={onGitHub}>
        Connect a GitHub repository
      </button>
      <button type="button" className="button-secondary" onClick={() => setCreating(true)}>
        New local repository
      </button>
    </section>
  );
}
