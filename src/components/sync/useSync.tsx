"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GitHubClient, GitHubError, type FileCommit } from "@/lib/github/client";
import { daysLeft, loadToken, saveToken, type StoredToken } from "@/lib/github/token-store";
import { verifyToken } from "@/lib/github/verify-token";
import { loadKeys, saveKeys } from "@/lib/crypto/key-store";
import { unlockWithPassphrase, unlockWithRecoveryKey, type RepoKeys } from "@/lib/crypto/repo-crypto";
import { EncryptedRemote, PlainRemote } from "@/lib/sync/encrypted-remote";
import { SyncEngine } from "@/lib/sync/engine";
import { probeRepo } from "@/lib/sync/encryption-setup";
import { GitHubRemote } from "@/lib/sync/remote";
import { IdbSyncState } from "@/lib/sync/state";
import type { LocalStore } from "@/lib/vault/local-store";
import { joinPath, noteTitle } from "@/lib/vault/paths";
import type { GitHubVaultConfig } from "@/lib/vault/registry";
import { useVault } from "../vault/useVault";

export type SyncStatus =
  | { kind: "local" } // not a synced vault
  | { kind: "idle"; pending: number; lastSyncedAt: number | null }
  | { kind: "syncing" }
  /** Encrypted, and this browser doesn't have the key yet. */
  | { kind: "locked" }
  /** Connected with a token, and this browser has none, or GitHub stopped accepting it. */
  | { kind: "needs_token"; reason: "missing" | "rejected" }
  | { kind: "offline"; pending: number }
  | { kind: "error"; message: string; pending: number };

interface SyncApi {
  status: SyncStatus;
  /** Syncs now (also what the Sync button does). */
  syncNow(): void;
  /** Messages about conflicts from the last sync, until dismissed. */
  notices: string[];
  dismissNotices(): void;
  /** Checks a new token for this repository and saves it. */
  setToken?(token: string): Promise<void>;
  /** Unlocks an encrypted repository on this device. Throws WrongKeyError. */
  unlock?(secret: string, kind: "passphrase" | "recovery key"): Promise<void>;
  /** Version history from GitHub, for synced vaults. */
  history?: {
    commits(path: string): Promise<FileCommit[]>;
    contentAt(sha: string, path: string): Promise<Uint8Array | null>;
    repoLabel: string;
  };
}

const SyncContext = createContext<SyncApi>({
  status: { kind: "local" },
  syncNow: () => {},
  notices: [],
  dismissNotices: () => {},
});

export const useSync = () => useContext(SyncContext);

/** This browser has no token for the repository yet. */
class TokenMissingError extends Error {}

/** Pull for remote changes this often while the tab is visible (auto mode). */
const POLL_MS = 5 * 60 * 1000;

/**
 * Runs the sync engine for a GitHub vault: on open, after edits (auto mode,
 * once typing has been idle for `idleSeconds`), when the tab is hidden, when
 * the tab regains focus or the network returns, and on a slow poll.
 * Manual mode syncs only on open and when asked.
 */
export function SyncProvider({
  config,
  store,
  children,
}: {
  config: GitHubVaultConfig;
  store: LocalStore;
  children: ReactNode;
}) {
  const vault = useVault();
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle", pending: 0, lastSyncedAt: null });
  const [notices, setNotices] = useState<string[]>([]);

  // The repository's personal access token lives in this browser. undefined while loading.
  const [stored, setStored] = useState<StoredToken | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadToken(config.id)
      .catch(() => undefined)
      .then((t) => {
        if (!live) return;
        setStored(t ?? null);
        if (!t) {
          setStatus({ kind: "needs_token", reason: "missing" });
          return;
        }
        const days = daysLeft(t.expiresAt);
        if (days !== null && days <= 7) {
          setNotices((n) => [
            ...n,
            days < 0
              ? "The GitHub token for this repository has expired."
              : `The GitHub token for this repository expires ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}. Replace it in Settings → Repositories & sync → Edit.`,
          ]);
        }
      });
    return () => {
      live = false;
    };
  }, [config.id]);
  const getToken = useMemo(
    () => async () => {
      if (!stored) throw new TokenMissingError();
      return stored.token;
    },
    [stored],
  );
  const client = useMemo(() => new GitHubClient(getToken), [getToken]);
  const github = useMemo(
    () => new GitHubRemote(client, config.owner, config.repo, config.branch),
    [client, config.owner, config.repo, config.branch],
  );

  // Encrypted repositories need this device's key: undefined while loading, null if locked.
  const encrypted = !!config.encrypted;
  const [keys, setKeys] = useState<RepoKeys | null | undefined>(undefined);
  useEffect(() => {
    if (!encrypted) return;
    let live = true;
    void loadKeys(config.id)
      .catch(() => undefined)
      .then((k) => {
        if (!live) return;
        setKeys(k ?? null);
        if (!k) setStatus({ kind: "locked" });
      });
    return () => {
      live = false;
    };
  }, [encrypted, config.id]);

  const remote = useMemo(
    () => (!encrypted ? new PlainRemote(github) : keys ? new EncryptedRemote(github, keys) : null),
    [encrypted, github, keys],
  );
  const engine = useMemo(
    () => (remote ? new SyncEngine(store, new IdbSyncState(config.id), remote, config.folder) : null),
    [remote, config.id, config.folder, store],
  );

  const running = useRef(false);
  const again = useRef(false);
  const vaultRef = useRef(vault);
  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  const run = useCallback(async () => {
    if (!engine) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        setStatus({ kind: "syncing" });
        await vaultRef.current.flush();
        try {
          const r = await engine.sync();
          await vaultRef.current.reload([...r.changedLocally]);
          if (r.conflicts.length) {
            setNotices((n) => [
              ...n,
              ...r.conflicts.map(
                (c) => `“${noteTitle(c)}” was changed here and on GitHub. Both versions were kept.`,
              ),
            ]);
          }
          const pending = await engine.pendingChanges();
          setStatus({ kind: "idle", pending, lastSyncedAt: Date.now() });
        } catch (e) {
          const pending = await engine.pendingChanges().catch(() => 0);
          if (e instanceof TokenMissingError || (e instanceof GitHubError && e.status === 401)) {
            setStatus({ kind: "needs_token", reason: e instanceof GitHubError ? "rejected" : "missing" });
          }
          else if (!navigator.onLine || e instanceof TypeError) setStatus({ kind: "offline", pending });
          else {
            const message =
              e instanceof GitHubError && e.status === 404
                ? `Can't reach ${config.owner}/${config.repo}. Check the token can access it.`
                : e instanceof Error
                  ? e.message
                  : String(e);
            setStatus({ kind: "error", message, pending });
          }
        }
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [engine, config.owner, config.repo]);

  // First sync once the vault has loaded, and again when the user signs in.
  const signedIn = !!stored;
  useEffect(() => {
    if (engine && vault.ready && signedIn) void run();
  }, [vault.ready, signedIn, run, engine]);

  // Auto mode: commit after the user stops editing.
  const idleMs = config.idleSeconds * 1000;
  const auto = config.syncMode === "auto";
  useEffect(() => {
    if (!vault.changeCounter || !engine) return;
    let cancelled = false;
    void engine.pendingChanges().then((pending) => {
      if (!cancelled) setStatus((s) => (s.kind === "idle" ? { ...s, pending } : s));
    });
    if (!auto || !signedIn) return;
    const t = setTimeout(() => void run(), idleMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [vault.changeCounter, auto, signedIn, idleMs, run, engine]);

  // Auto mode: sync when leaving the tab, on return, when back online, and on a slow poll.
  useEffect(() => {
    if (!auto || !signedIn) return;
    const onVisibility = () => void run();
    const onOnline = () => void run();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      clearInterval(poll);
    };
  }, [auto, signedIn, run]);

  // Switching away from the vault: push what's left (auto mode).
  useEffect(() => {
    return () => {
      if (auto && signedIn && engine) void vaultRef.current.flush().then(() => engine.sync().catch(() => {}));
    };
  }, [auto, signedIn, engine]);

  const unlock = useCallback(
    async (secret: string, kind: "passphrase" | "recovery key") => {
      const probe = await probeRepo(github);
      if (probe.kind !== "encrypted") throw new Error("This repository isn't encrypted any more.");
      const k =
        kind === "passphrase"
          ? await unlockWithPassphrase(probe.header, secret)
          : await unlockWithRecoveryKey(probe.header, secret);
      await saveKeys(config.id, k);
      setKeys(k);
      setStatus({ kind: "idle", pending: 0, lastSyncedAt: null });
    },
    [github, config.id],
  );

  const setToken = useCallback(
    async (token: string) => {
      const next = await verifyToken(token, { owner: config.owner, repo: config.repo });
      await saveToken(config.id, next);
      setStored(next);
      setStatus({ kind: "idle", pending: 0, lastSyncedAt: null });
    },
    [config.id, config.owner, config.repo],
  );

  const api = useMemo<SyncApi>(() => {
    const repoPath = (path: string) => joinPath(config.folder, path);
    const enc = remote instanceof EncryptedRemote ? remote : null;
    return {
      status,
      syncNow: () => void run(),
      notices,
      dismissNotices: () => setNotices([]),
      unlock: encrypted ? unlock : undefined,
      setToken,
      history:
        encrypted && !enc
          ? undefined
          : {
              commits: async (path) =>
                client.fileHistory(
                  config.owner,
                  config.repo,
                  config.branch,
                  enc ? await enc.storedPath(repoPath(path)) : repoPath(path),
                ),
              contentAt: async (sha, path) => {
                if (!enc) return client.fileAt(config.owner, config.repo, sha, repoPath(path));
                const data = await client.fileAt(config.owner, config.repo, sha, await enc.storedPath(repoPath(path)));
                return data && enc.decrypt(data);
              },
              repoLabel: `${config.owner}/${config.repo}`,
            },
    };
  }, [status, run, notices, client, config.owner, config.repo, config.branch, config.folder, encrypted, remote, unlock, setToken]);
  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>;
}
