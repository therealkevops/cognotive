"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { HashEmbedder, type Embedder } from "@/lib/semantic/embedder";
import { idbVectorStore } from "@/lib/semantic/idb-store";
import { SemanticIndex, type SemanticHit } from "@/lib/semantic/semantic-index";
import { WorkerEmbedder } from "@/lib/semantic/worker-embedder";
import { displayName, isNote } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

export type SemanticStatus =
  | { state: "off" }
  | { state: "starting" }
  | { state: "downloading"; loaded: number; total: number }
  | { state: "indexing"; done: number; total: number }
  | { state: "ready"; notes: number }
  | { state: "error"; message: string };

export interface SemanticApi {
  /** Turned on in this browser (the model is downloaded once, then kept). */
  enabled: boolean;
  status: SemanticStatus;
  setEnabled(on: boolean): void;
  /** Forgets this repository's vectors and builds them again. */
  rebuild(): void;
  /** Notes matching a query by meaning ([] when off). */
  search(query: string, limit?: number): Promise<SemanticHit[]>;
  /** Notes closest in meaning to a note ([] when off or not indexed yet). */
  similar(path: string, limit?: number): SemanticHit[];
  /** Changes after each indexing pass, so views showing similar notes update. */
  version: number;
}

const OFF: SemanticApi = {
  enabled: false,
  status: { state: "off" },
  setEnabled: () => {},
  rebuild: () => {},
  search: async () => [],
  similar: () => [],
  version: 0,
};

const SemanticContext = createContext<SemanticApi>(OFF);
export const useSemantic = () => useContext(SemanticContext);

const PREF = "semantic";
const SYNC_DELAY_MS = 1500;

/**
 * Search by meaning for the open repository: an index of every note's
 * passages, built in the background and kept up to date as notes change.
 */
export function SemanticProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [enabled, setEnabledState] = useState(() => readPref<boolean>(PREF, false));
  const [status, setStatus] = useState<SemanticStatus>(enabled ? { state: "starting" } : { state: "off" });
  const [version, setVersion] = useState(0);
  const indexRef = useRef<SemanticIndex | null>(null);
  const embedderRef = useRef<Embedder | null>(null);
  const run = useRef<{ busy: boolean; again: boolean; ctrl: AbortController | null }>({ busy: false, again: false, ctrl: null });

  const setEnabled = useCallback((on: boolean) => {
    writePref(PREF, on);
    setEnabledState(on);
    setStatus(on ? { state: "starting" } : { state: "off" });
  }, []);

  // One index per repository while on; the model stops when it's turned off.
  useEffect(() => {
    if (!enabled) return;
    // "hash" matches words only and needs no model: for tests.
    const embedder: Embedder =
      readPref<string>("semanticEngine", "model") === "hash"
        ? new HashEmbedder()
        : new WorkerEmbedder((loaded, total) => total && loaded < total && setStatus({ state: "downloading", loaded, total }));
    embedderRef.current = embedder;
    indexRef.current = new SemanticIndex(idbVectorStore(vault.vaultId), embedder);
    const r = run.current;
    return () => {
      r.ctrl?.abort();
      if (embedder instanceof WorkerEmbedder) embedder.stop();
      indexRef.current = null;
      embedderRef.current = null;
    };
  }, [enabled, vault.vaultId]);

  const sync = useCallback(async () => {
    const ix = indexRef.current;
    const r = run.current;
    if (!ix || !vault.ready) return;
    if (r.busy) {
      r.again = true;
      return;
    }
    r.busy = true;
    r.ctrl = new AbortController();
    try {
      const files = vault.links
        .paths()
        .filter(isNote)
        .map((path) => ({ path, title: displayName(path), content: vault.links.content(path) ?? "" }));
      await ix.sync(files, {
        signal: r.ctrl.signal,
        onProgress: (done, total) => total && done < total && setStatus({ state: "indexing", done, total }),
      });
      if (indexRef.current === ix && !r.ctrl.signal.aborted) {
        setStatus({ state: "ready", notes: ix.size });
        setVersion((v) => v + 1);
      }
    } catch (e) {
      if (indexRef.current === ix) setStatus({ state: "error", message: (e as Error).message || "Search by meaning stopped." });
    } finally {
      r.busy = false;
      if (r.again) {
        r.again = false;
        void sync();
      }
    }
  }, [vault.ready, vault.links]);

  // Index on start, then shortly after notes change.
  useEffect(() => {
    if (!enabled || !vault.ready) return;
    const t = setTimeout(() => void sync(), indexRef.current?.size ? SYNC_DELAY_MS : 0);
    return () => clearTimeout(t);
  }, [enabled, vault.ready, vault.indexed.version, sync]);

  const search = useCallback(async (q: string, limit?: number) => (indexRef.current ? indexRef.current.search(q, limit) : []), []);
  const similar = useCallback((p: string, limit?: number) => indexRef.current?.similar(p, limit) ?? [], []);
  const api = useMemo<SemanticApi>(
    () => ({
      enabled,
      status,
      version,
      setEnabled,
      rebuild: () => {
        const ix = indexRef.current;
        if (!ix) return;
        run.current.ctrl?.abort();
        void ix.clear().then(() => {
          setStatus({ state: "starting" });
          void sync();
        });
      },
      search,
      similar,
    }),
    [enabled, status, version, setEnabled, sync, search, similar],
  );
  return <SemanticContext.Provider value={api}>{children}</SemanticContext.Provider>;
}
