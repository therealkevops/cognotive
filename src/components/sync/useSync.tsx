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
import { GitHubClient, GitHubError } from "@/lib/github/client";
import { SyncEngine } from "@/lib/sync/engine";
import { GitHubRemote } from "@/lib/sync/remote";
import { IdbSyncState } from "@/lib/sync/state";
import type { LocalStore } from "@/lib/vault/local-store";
import { noteTitle } from "@/lib/vault/paths";
import type { GitHubVaultConfig } from "@/lib/vault/registry";
import { AuthRequiredError, useAuth } from "../auth/useAuth";
import { useVault } from "../vault/useVault";

export type SyncStatus =
  | { kind: "local" } // not a synced vault
  | { kind: "idle"; pending: number; lastSyncedAt: number | null }
  | { kind: "syncing" }
  | { kind: "signed_out" }
  | { kind: "offline"; pending: number }
  | { kind: "error"; message: string; pending: number };

interface SyncApi {
  status: SyncStatus;
  /** Syncs now (also what the Sync button does). */
  syncNow(): void;
  /** Messages about conflicts from the last sync, until dismissed. */
  notices: string[];
  dismissNotices(): void;
}

const SyncContext = createContext<SyncApi>({
  status: { kind: "local" },
  syncNow: () => {},
  notices: [],
  dismissNotices: () => {},
});

export const useSync = () => useContext(SyncContext);

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
  const auth = useAuth();
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle", pending: 0, lastSyncedAt: null });
  const [notices, setNotices] = useState<string[]>([]);

  const engine = useMemo(() => {
    const client = new GitHubClient(auth.getToken);
    const remote = new GitHubRemote(client, config.owner, config.repo, config.branch);
    return new SyncEngine(store, new IdbSyncState(config.id), remote, config.folder);
    // auth.getToken is stable; the engine only changes with the vault.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.owner, config.repo, config.branch, config.folder, store]);

  const running = useRef(false);
  const again = useRef(false);
  const vaultRef = useRef(vault);
  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  const run = useCallback(async () => {
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
          if (e instanceof AuthRequiredError) setStatus({ kind: "signed_out" });
          else if (!navigator.onLine || e instanceof TypeError) setStatus({ kind: "offline", pending });
          else {
            const message =
              e instanceof GitHubError && e.status === 404
                ? `Can't reach ${config.owner}/${config.repo}. Check the GitHub App can access it.`
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
  const signedIn = auth.state.status === "signed_in";
  useEffect(() => {
    if (vault.ready && signedIn) void run();
    else if (vault.ready && auth.state.status === "signed_out") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors external auth state
      setStatus({ kind: "signed_out" });
    }
  }, [vault.ready, signedIn, auth.state.status, run]);

  // Auto mode: commit after the user stops editing.
  const idleMs = config.idleSeconds * 1000;
  const auto = config.syncMode === "auto";
  useEffect(() => {
    if (!vault.changeCounter) return;
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
    const onOnline = () => void auth.refresh().then(run);
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
  }, [auto, signedIn, run, auth]);

  // Switching away from the vault: push what's left (auto mode).
  useEffect(() => {
    return () => {
      if (auto && signedIn) void vaultRef.current.flush().then(() => engine.sync().catch(() => {}));
    };
  }, [auto, signedIn, engine]);

  const api = useMemo<SyncApi>(
    () => ({
      status,
      syncNow: () => void run(),
      notices,
      dismissNotices: () => setNotices([]),
    }),
    [status, run, notices],
  );
  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>;
}
