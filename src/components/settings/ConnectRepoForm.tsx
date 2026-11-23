"use client";

import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { saveKeys } from "@/lib/crypto/key-store";
import { createEncryption, unlockWithPassphrase, unlockWithRecoveryKey } from "@/lib/crypto/repo-crypto";
import { GitHubClient, type RepoSummary } from "@/lib/github/client";
import { saveToken, type StoredToken } from "@/lib/github/token-store";
import { verifyToken } from "@/lib/github/verify-token";
import { probeRepo, writeEncryptionHeader, type RepoProbe } from "@/lib/sync/encryption-setup";
import { GitHubRemote } from "@/lib/sync/remote";
import { normalizePath } from "@/lib/vault/paths";
import { DEFAULT_IDLE_SECONDS, newVaultId, type GitHubVaultConfig, type SyncMode } from "@/lib/vault/registry";
import { MIN_PASSPHRASE, newPassphraseError, RecoveryKeyStep, UnlockFields, type SecretKind } from "../sync/EncryptionFields";
import { TokenInstructions } from "../sync/TokenFields";
import { useVaults } from "../vault/useVaults";
import { Field, StarterTemplatesOption, SyncFields } from "./repo-fields";

/* Connecting a GitHub repository. */

export function ConnectRepoForm({ onDone }: { onDone(): void }) {
  const { add } = useVaults();
  const [patText, setPatText] = useState("");
  const [pat, setPat] = useState<StoredToken | null>(null);
  const [checkingPat, setCheckingPat] = useState(false);
  const client = useMemo(
    () => new GitHubClient(async () => pat?.token ?? ""),
    [pat],
  );
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [syncMode, setSyncMode] = useState<SyncMode>("auto");
  const [idle, setIdle] = useState(DEFAULT_IDLE_SECONDS);
  // Encryption: what the chosen branch holds, and the secrets typed for it.
  const [probe, setProbe] = useState<RepoProbe | "checking" | null>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [secretKind, setSecretKind] = useState<SecretKind>("passphrase");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{ key: string; config: GitHubVaultConfig } | null>(null);
  // Starter templates: suggested for a new, empty repository; off when it already has notes. null: follow that.
  const [starters, setStarters] = useState<boolean | null>(null);
  // Can the token write to the chosen repository? Public ones are listed even when it can only read.
  const [writable, setWritable] = useState<boolean | "checking">(true);

  const checkPat = () => {
    setCheckingPat(true);
    setError(null);
    verifyToken(patText)
      .then(async (t) => {
        const gh = new GitHubClient(async () => t.token);
        const list = await gh.writableRepos(await gh.listUserRepos());
        setPat(t);
        setRepos(list);
        if (!list.length) {
          setError(
            "This token can't write to any repository yet. Open it on GitHub (Settings → Developer settings → Fine-grained tokens), add your notes repository under Repository access, and set Contents to Read and write. Then use the token again.",
          );
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCheckingPat(false));
  };
  const resetToken = () => {
    setPat(null);
    setPatText("");
    setRepos(null);
    setRepoName("");
    setProbe(null);
    setError(null);
  };

  const repo = repos?.find((r) => r.fullName === repoName);
  useEffect(() => {
    if (!repo || !branch) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the check while GitHub answers
    setProbe("checking");
    probeRepo(new GitHubRemote(client, repo.owner, repo.name, branch))
      .then((p) => live && setProbe(p))
      .catch((e: unknown) => {
        if (!live) return;
        setProbe(null);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [client, repo, branch]);
  const pickRepo = (fullName: string) => {
    setRepoName(fullName);
    setWritable("checking");
    const r = repos?.find((x) => x.fullName === fullName);
    if (!r) return;
    client
      .canWrite(r.owner, r.name)
      .then((ok) => setWritable(ok !== false))
      .catch(() => setWritable(true)); // can't tell; sync will report a real problem
    setName((n) => n || r.name);
    setBranch(r.defaultBranch);
    setBranches([r.defaultBranch]);
    client
      .listBranches(r.owner, r.name)
      .then((b) => setBranches(b.length ? b : [r.defaultBranch]))
      .catch(() => {});
  };

  if (recovery) {
    return (
      <RecoveryKeyStep
        recoveryKey={recovery.key}
        repoLabel={`${recovery.config.owner}/${recovery.config.repo}`}
        onDone={() => {
          add(recovery.config);
          onDone();
        }}
      />
    );
  }

  const probeKind = probe && typeof probe === "object" ? probe.kind : null;
  const passError = probeKind === "empty" && encrypt ? newPassphraseError(pass, confirm) : null;
  const wantStarters = starters ?? probeKind === "empty";
  const ready = writable === true && probe !== "checking" && (probeKind === "encrypted" ? !!secret.trim() : !passError);

  let folderError: string | null = null;
  let cleanFolder = "";
  try {
    cleanFolder = normalizePath(folder);
    if (cleanFolder.split("/").some((s) => s.startsWith("."))) folderError = "Hidden folders can't hold a repository.";
  } catch {
    folderError = 'The folder can\'t contain "..".';
  }

  return (
    <form
      aria-label="Connect a GitHub repository"
      className="space-y-4 rounded-xl border border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!repo || !branch || folderError || !ready || busy) return;
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
          ...(wantStarters ? { starterTemplates: true } : {}),
        };
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            if (pat) await saveToken(config.id, pat);
            if (!probeKind || probeKind === "plain" || (probeKind === "empty" && !encrypt)) {
              add(config);
              onDone();
            } else if (probe && typeof probe === "object" && probe.kind === "encrypted") {
              const keys =
                secretKind === "passphrase"
                  ? await unlockWithPassphrase(probe.header, secret)
                  : await unlockWithRecoveryKey(probe.header, secret);
              await saveKeys(config.id, keys);
              add({ ...config, encrypted: true });
              onDone();
            } else {
              const { header, keys, recoveryKey } = await createEncryption(pass);
              await writeEncryptionHeader(new GitHubRemote(client, repo.owner, repo.name, branch), header);
              await saveKeys(config.id, keys);
              setRecovery({ key: recoveryKey, config: { ...config, encrypted: true } });
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h4 className="font-serif text-lg">Connect a GitHub repository</h4>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          CogNotive.ai syncs with a GitHub token that can only reach the repositories you pick.
        </p>
        {pat ? (
          <p className="flex items-center justify-between gap-2 text-sm">
            <span>
              Token for <strong>@{pat.login}</strong>
              {pat.expiresAt ? `, expires ${new Date(pat.expiresAt).toLocaleDateString()}` : ", doesn't expire"}
            </span>
            <button
              type="button"
              className="text-xs text-muted underline hover:text-accent"
              onClick={resetToken}
            >
              Use another token
            </button>
          </p>
        ) : (
          <>
            <TokenInstructions />
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
                <span className="font-medium">GitHub token</span>
                <input
                  className="input font-mono"
                  type="password"
                  autoComplete="off"
                  placeholder="github_pat_…"
                  value={patText}
                  onChange={(e) => setPatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (patText.trim() && !checkingPat) checkPat();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="button-primary"
                disabled={!patText.trim() || checkingPat}
                onClick={checkPat}
              >
                {checkingPat ? "Checking access…" : "Continue"}
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {pat && (
        <Field
          label="Repository"
          hint={
            writable === false
              ? undefined
              : "Repositories this token can write to."
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
      )}
      {pat && repo && writable === false && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          This token can only read {repo.fullName}, so it can&apos;t sync there. Add the repository to the token&apos;s
          repository access on GitHub, with Contents set to Read and write, then{" "}
          <button type="button" className="font-medium underline" onClick={() => pickRepo(repo.fullName)}>
            check again
          </button>
          .
        </p>
      )}
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
          <Field label="Folder in the GitHub repository" hint={folderError ?? "Leave empty to use the whole GitHub repository, or name a subfolder such as notes."}>
            <input className="input" value={folder} placeholder="(whole repository)" onChange={(e) => setFolder(e.target.value)} />
          </Field>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <SyncFields mode={syncMode} setMode={setSyncMode} idle={idle} setIdle={setIdle} />
          <StarterTemplatesOption checked={wantStarters} onChange={setStarters} />
          <fieldset className="space-y-3 rounded-lg bg-surface p-4" aria-label="Encryption">
            {probe === "checking" && <p className="text-sm text-muted">Checking the repository…</p>}
            {probeKind === "encrypted" && (
              <>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Lock size={15} aria-hidden /> This repository is encrypted
                </p>
                <UnlockFields kind={secretKind} setKind={setSecretKind} secret={secret} setSecret={setSecret} />
              </>
            )}
            {probeKind === "empty" && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
                  <span>
                    <span className="font-medium">Encrypt this repository</span>
                    <span className="block text-xs text-muted">
                      Notes and their names are encrypted in this browser before they reach GitHub. GitHub, and anyone
                      who gets into your account, sees only scrambled files.
                    </span>
                  </span>
                </label>
                {encrypt && (
                  <>
                    <Field label="Passphrase" hint={`At least ${MIN_PASSPHRASE} characters. You'll need it once on each device.`}>
                      <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                    </Field>
                    <Field label="Confirm passphrase">
                      <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    </Field>
                    {pass && passError && <p className="text-xs text-muted">{passError}</p>}
                  </>
                )}
              </>
            )}
            {probeKind === "plain" && (
              <p className="text-xs text-muted">
                This repository already has unencrypted files, so it will sync without encryption. To encrypt, use a new,
                empty repository: older versions stay readable in a repository&apos;s history.
              </p>
            )}
          </fieldset>
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={!repo || !!folderError || !ready || busy}>
          {busy ? (probeKind === "encrypted" ? "Unlocking…" : "Encrypting…") : "Connect and open"}
        </button>
      </div>
    </form>
  );
}
