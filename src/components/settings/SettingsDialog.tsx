"use client";

import { FolderGit2, HardDrive, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ACCENTS, loadAppearance, saveAppearance, type Appearance } from "@/lib/appearance";
import { GitHubClient, type RepoSummary } from "@/lib/github/client";
import { formatDate } from "@/lib/vault/settings";
import { normalizePath } from "@/lib/vault/paths";
import {
  DEFAULT_IDLE_SECONDS,
  describeVault,
  newVaultId,
  type GitHubVaultConfig,
  type SyncMode,
  type VaultConfig,
} from "@/lib/vault/registry";
import { useAuth } from "../auth/useAuth";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";

/** Settings: GitHub account, the vault list, and connecting a repository. */
export function SettingsDialog({ onClose }: { onClose(): void }) {
  const [adding, setAdding] = useState<null | "github">(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-[6vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-xl rounded-lg border border-border bg-background shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Settings</h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="space-y-6 px-5 py-4">
          <AppearanceSection />
          <ThisVaultSection />
          <AccountSection />
          <VaultList />
          {adding === "github" ? (
            <ConnectRepoForm onDone={() => setAdding(null)} />
          ) : (
            <AddButtons onGitHub={() => setAdding("github")} />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h3>;
}

function AppearanceSection() {
  const [a, setA] = useState<Appearance>(loadAppearance);
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    saveAppearance(next);
  };
  return (
    <section aria-label="Appearance">
      <SectionTitle>Appearance (this browser)</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Theme">
          <select className="input" value={a.theme} onChange={(e) => set({ theme: e.target.value as Appearance["theme"] })}>
            <option value="system">Match the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <Field label="Line width">
          <select
            className="input"
            value={a.lineWidth}
            onChange={(e) => set({ lineWidth: e.target.value as Appearance["lineWidth"] })}
          >
            <option value="narrow">Narrow</option>
            <option value="normal">Normal</option>
            <option value="wide">Wide</option>
            <option value="full">Full width</option>
          </select>
        </Field>
        <Field label="Clicking a link in live preview">
          <select
            className="input"
            value={a.linkClick}
            onChange={(e) => set({ linkClick: e.target.value as Appearance["linkClick"] })}
          >
            <option value="edit">Edits it (↗ or Ctrl/Cmd-click opens it)</option>
            <option value="follow">Opens it</option>
          </select>
        </Field>
        <Field label={`Text size: ${a.fontSize}px`}>
          <input
            type="range"
            min={13}
            max={22}
            value={a.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Accent colour</legend>
          <div className="flex gap-2">
            {(Object.keys(ACCENTS) as Array<Appearance["accent"]>).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={a.accent === name}
                className={`h-7 w-7 rounded-full border-2 ${a.accent === name ? "border-foreground" : "border-transparent"}`}
                style={{ background: ACCENTS[name].light }}
                onClick={() => set({ accent: name })}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function ThisVaultSection() {
  const { settings, updateSettings } = useVault();
  const [draft, setDraft] = useState(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <section aria-label="This vault">
      <SectionTitle>This vault</SectionTitle>
      <p className="mb-3 text-xs text-muted">Saved in the vault at .noted/settings.json, so they sync with it.</p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void updateSettings(draft);
        }}
      >
        <Field label="Attachment folder">
          <input className="input" value={draft.attachmentFolder} onChange={(e) => setDraft({ ...draft, attachmentFolder: e.target.value })} />
        </Field>
        <Field label="Templates folder">
          <input className="input" value={draft.templateFolder} onChange={(e) => setDraft({ ...draft, templateFolder: e.target.value })} />
        </Field>
        <Field label="Daily notes folder">
          <input className="input" value={draft.dailyFolder} onChange={(e) => setDraft({ ...draft, dailyFolder: e.target.value })} />
        </Field>
        <Field label="Daily note name" hint={`Today: ${formatDate(new Date(), draft.dailyFormat || "YYYY-MM-DD")}`}>
          <input className="input" value={draft.dailyFormat} onChange={(e) => setDraft({ ...draft, dailyFormat: e.target.value })} />
        </Field>
        <Field label="Daily note template" hint="A note path, e.g. Templates/Daily.md. Empty for none.">
          <input className="input" value={draft.dailyTemplate} onChange={(e) => setDraft({ ...draft, dailyTemplate: e.target.value })} />
        </Field>
        <label className="flex items-start gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.drawingSvgCopy}
            onChange={(e) => setDraft({ ...draft, drawingSvgCopy: e.target.checked })}
          />
          <span>Save an SVG copy next to each drawing (so drawings show on github.com)</span>
        </label>
        <div className="flex justify-end sm:col-span-2">
          <button type="submit" className="button-primary" disabled={!dirty}>
            Save vault settings
          </button>
        </div>
      </form>
    </section>
  );
}

function AccountSection() {
  const { state, signIn, signOut } = useAuth();
  return (
    <section aria-label="GitHub account">
      <SectionTitle>GitHub account</SectionTitle>
      {state.status === "loading" && <p className="text-sm text-muted">Checking…</p>}
      {state.status === "signed_in" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">
            Signed in as <strong>@{state.user.login}</strong>
          </p>
          <button type="button" className="button-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
      {state.status === "signed_out" && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Sign in to keep vaults in GitHub repositories.</p>
          <button type="button" className="button-primary" onClick={signIn}>
            Sign in with GitHub
          </button>
        </div>
      )}
      {state.status === "not_configured" && (
        <p className="text-sm text-muted">
          GitHub sign-in isn&apos;t set up on this deployment yet. Add the GitHub App settings described in the
          README, then redeploy.
        </p>
      )}
      {state.status === "offline" && <p className="text-sm text-muted">Offline. Can&apos;t reach the sign-in service.</p>}
    </section>
  );
}

function VaultList() {
  const { vaults, active, switchTo, remove, update } = useVaults();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section aria-label="Vaults">
      <SectionTitle>Vaults</SectionTitle>
      <ul className="divide-y divide-border rounded-md border border-border">
        {vaults.map((v) => (
          <li key={v.id} className="px-3 py-2.5">
            <div className="flex items-center gap-3">
              {v.kind === "github" ? (
                <FolderGit2 size={18} className="shrink-0 text-muted" aria-hidden />
              ) : (
                <HardDrive size={18} className="shrink-0 text-muted" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {v.name}
                  {v.id === active.id && <span className="ml-2 text-xs font-normal text-accent">Open</span>}
                </p>
                <p className="truncate text-xs text-muted">{describeVault(v)}</p>
              </div>
              {v.id !== active.id && (
                <button type="button" className="button-secondary" onClick={() => switchTo(v.id)}>
                  Open
                </button>
              )}
              <button
                type="button"
                className="button-secondary"
                aria-expanded={editing === v.id}
                onClick={() => setEditing(editing === v.id ? null : v.id)}
              >
                Edit
              </button>
            </div>
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

function EditVault({
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
      className="mt-3 space-y-3 rounded-md bg-surface p-3"
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
      <div className="flex justify-between gap-2">
        <button
          type="button"
          className="text-sm text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
          disabled={!canRemove}
          title={canRemove ? undefined : "Keep at least one vault"}
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

function SyncFields({
  mode,
  setMode,
  idle,
  setIdle,
}: {
  mode: SyncMode;
  setMode(m: SyncMode): void;
  idle: number;
  setIdle(n: number): void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Sync</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="sync" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-1" />
        <span>
          Automatic: commit
          <input
            type="number"
            min={5}
            max={3600}
            aria-label="Seconds after the last edit"
            className="input mx-1.5 inline-block w-16 py-0.5"
            value={idle}
            disabled={mode !== "auto"}
            onChange={(e) => setIdle(Math.max(5, Math.min(3600, Number(e.target.value) || DEFAULT_IDLE_SECONDS)))}
          />
          seconds after you stop typing, and when you leave the tab
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="sync" checked={mode === "manual"} onChange={() => setMode("manual")} className="mt-1" />
        <span>Manual: only when you press Sync</span>
      </label>
    </fieldset>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function AddButtons({ onGitHub }: { onGitHub(): void }) {
  const { add } = useVaults();
  return (
    <section aria-label="Add a vault" className="flex flex-wrap gap-2">
      <button type="button" className="button-primary" onClick={onGitHub}>
        Connect a GitHub repository
      </button>
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          const name = window.prompt("Name for the new vault", "New vault");
          if (name?.trim()) add({ id: newVaultId("local"), name: name.trim(), kind: "local" });
        }}
      >
        New local vault
      </button>
    </section>
  );
}

function ConnectRepoForm({ onDone }: { onDone(): void }) {
  const auth = useAuth();
  const { add } = useVaults();
  const client = useMemo(() => new GitHubClient(auth.getToken), [auth.getToken]);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [syncMode, setSyncMode] = useState<SyncMode>("auto");
  const [idle, setIdle] = useState(DEFAULT_IDLE_SECONDS);

  const signedIn = auth.state.status === "signed_in";
  useEffect(() => {
    if (!signedIn) return;
    client
      .listRepos()
      .then(setRepos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [client, signedIn]);

  const repo = repos?.find((r) => r.fullName === repoName);
  const pickRepo = (fullName: string) => {
    setRepoName(fullName);
    const r = repos?.find((x) => x.fullName === fullName);
    if (!r) return;
    setName((n) => n || r.name);
    setBranch(r.defaultBranch);
    setBranches([r.defaultBranch]);
    client
      .listBranches(r.owner, r.name)
      .then((b) => setBranches(b.length ? b : [r.defaultBranch]))
      .catch(() => {});
  };

  if (!signedIn) {
    return (
      <section aria-label="Connect a GitHub repository" className="rounded-md border border-border p-3 text-sm">
        <p className="mb-2">Sign in with GitHub first.</p>
        <div className="flex gap-2">
          {auth.state.status === "signed_out" && (
            <button type="button" className="button-primary" onClick={auth.signIn}>
              Sign in with GitHub
            </button>
          )}
          <button type="button" className="button-secondary" onClick={onDone}>
            Cancel
          </button>
        </div>
      </section>
    );
  }

  let folderError: string | null = null;
  let cleanFolder = "";
  try {
    cleanFolder = normalizePath(folder);
    if (cleanFolder.split("/").some((s) => s.startsWith("."))) folderError = "Hidden folders can't hold a vault.";
  } catch {
    folderError = 'The folder can\'t contain "..".';
  }

  return (
    <form
      aria-label="Connect a GitHub repository"
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!repo || !branch || folderError) return;
        const config: GitHubVaultConfig = {
          id: newVaultId("github"),
          kind: "github",
          name: name.trim() || repo.name,
          owner: repo.owner,
          repo: repo.name,
          branch,
          folder: cleanFolder,
          syncMode,
          idleSeconds: idle,
        };
        add(config);
        onDone();
      }}
    >
      <h3 className="text-sm font-semibold">Connect a GitHub repository</h3>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Field
        label="Repository"
        hint={
          <>
            Only repositories the noted-ai GitHub App is installed on are listed.{" "}
            {auth.state.status === "signed_in" && auth.state.installUrl && (
              <a className="text-accent underline" href={auth.state.installUrl} target="_blank" rel="noreferrer">
                Choose repositories
              </a>
            )}
          </>
        }
      >
        <select
          className="input"
          value={repoName}
          onChange={(e) => pickRepo(e.target.value)}
          disabled={!repos}
          required
        >
          <option value="">{repos ? (repos.length ? "Choose a repository…" : "No repositories yet") : "Loading…"}</option>
          {repos?.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.fullName}
              {r.private ? " (private)" : ""}
            </option>
          ))}
        </select>
      </Field>
      {repo && (
        <>
          <Field label="Branch">
            <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vault folder" hint={folderError ?? "Leave empty to use the whole repository, or name a subfolder such as notes."}>
            <input className="input" value={folder} placeholder="(whole repository)" onChange={(e) => setFolder(e.target.value)} />
          </Field>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <SyncFields mode={syncMode} setMode={setSyncMode} idle={idle} setIdle={setIdle} />
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={!repo || !!folderError}>
          Connect and open
        </button>
      </div>
    </form>
  );
}
