"use client";

import { ExternalLink, X } from "lucide-react";
import { diffComm } from "node-diff3";
import { useEffect, useMemo, useState } from "react";
import type { FileCommit } from "@/lib/github/client";
import { basename, isBinary, isImage, mimeType } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { useSync } from "./useSync";

type Line = { kind: "same" | "added" | "removed"; text: string };

/** Line diff from `before` to `after`, with long unchanged runs collapsed. */
export function lineDiff(before: string, after: string): Line[] {
  const out: Line[] = [];
  for (const part of diffComm(before.split("\n"), after.split("\n"))) {
    if (part.common) {
      const c = part.common;
      if (c.length > 6) {
        out.push(...c.slice(0, 2).map((text) => ({ kind: "same" as const, text })));
        out.push({ kind: "same", text: `⋯ ${c.length - 4} unchanged lines ⋯` });
        out.push(...c.slice(-2).map((text) => ({ kind: "same" as const, text })));
      } else out.push(...c.map((text) => ({ kind: "same" as const, text })));
    } else {
      out.push(...(part.buffer1 ?? []).map((text) => ({ kind: "removed" as const, text })));
      out.push(...(part.buffer2 ?? []).map((text) => ({ kind: "added" as const, text })));
    }
  }
  return out;
}

/**
 * A file's GitHub history: pick a version to see what changed since then,
 * and restore it. Restoring writes it as a new edit, which the next sync commits.
 */
export function HistoryDialog({ path, onClose }: { path: string; onClose(): void }) {
  const vault = useVault();
  const { history } = useSync();
  const [commits, setCommits] = useState<FileCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileCommit | null>(null);
  const [version, setVersion] = useState<{ sha: string; bytes: Uint8Array | null } | null>(null);
  const binary = isBinary(path);
  const current = vault.textOf(path) ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!history) return;
    history
      .commits(path)
      .then((c) => {
        setCommits(c);
        setSelected(c[0] ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [history, path]);

  useEffect(() => {
    if (!history || !selected) return;
    let live = true;
    history
      .contentAt(selected.sha, path)
      .then((bytes) => live && setVersion({ sha: selected.sha, bytes }))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [history, selected, path]);

  const loaded = version && version.sha === selected?.sha ? version : null;
  const text = loaded?.bytes && !binary ? new TextDecoder().decode(loaded.bytes) : null;
  const diff = useMemo(() => (text !== null ? lineDiff(text, current) : null), [text, current]);
  const imageUrl = useMemo(
    () => (loaded?.bytes && isImage(path) ? URL.createObjectURL(new Blob([loaded.bytes.slice().buffer], { type: mimeType(path) })) : null),
    [loaded, path],
  );
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  return (
    <div className="dialog-backdrop py-[5vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        className="dialog-panel flex h-[85vh] max-w-5xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="min-w-0 flex-1 truncate font-serif text-xl">History of {basename(path)}</h2>
          <button type="button" className="icon-button" aria-label="Close history" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        {!history ? (
          <p className="p-6 text-sm text-muted">Version history is available for repositories synced with GitHub.</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : !commits ? (
          <p className="p-6 text-sm text-muted">Loading history from {history.repoLabel}…</p>
        ) : commits.length === 0 ? (
          <p className="p-6 text-sm text-muted">No commits yet. This file hasn&apos;t been synced to GitHub.</p>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ul aria-label="Versions" className="w-64 shrink-0 overflow-y-auto border-r border-border py-1">
              {commits.map((c) => (
                <li key={c.sha}>
                  <button
                    type="button"
                    aria-current={selected?.sha === c.sha}
                    className={`w-full px-4 py-2 text-left text-sm ${selected?.sha === c.sha ? "bg-accent/15" : "hover:bg-foreground/5"}`}
                    onClick={() => setSelected(c)}
                  >
                    <span className="block font-medium">{new Date(c.date).toLocaleString()}</span>
                    <span className="block truncate text-xs text-muted">{c.message}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex min-w-0 flex-1 flex-col">
              {selected && (
                <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {selected.author} · {selected.message}
                  </span>
                  <a href={selected.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
                    GitHub <ExternalLink size={12} aria-hidden />
                  </a>
                  {text !== null && (
                    <button
                      type="button"
                      className="button-primary"
                      disabled={text === current}
                      onClick={async () => {
                        await vault.writeNote(path, text);
                        onClose();
                      }}
                    >
                      Restore this version
                    </button>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {!loaded ? (
                  <p className="text-sm text-muted">Loading version…</p>
                ) : loaded.bytes === null ? (
                  <p className="text-sm text-muted">The file didn&apos;t exist in this version.</p>
                ) : imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- object URL of a past version
                  <img src={imageUrl} alt={`${basename(path)} at this version`} className="max-w-full" />
                ) : diff ? (
                  <>
                    <p className="mb-2 text-xs text-muted">
                      {text === current ? "Same as now." : "Changes from this version to now: red was removed since, green was added."}
                    </p>
                    <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap" data-testid="history-diff">
                      {diff.map((l, i) => (
                        <div
                          key={i}
                          className={
                            l.kind === "added"
                              ? "bg-green-500/15 text-green-800 dark:text-green-300"
                              : l.kind === "removed"
                                ? "bg-red-500/15 text-red-800 line-through dark:text-red-300"
                                : "text-muted"
                          }
                        >
                          {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
                          {l.text || " "}
                        </div>
                      ))}
                    </pre>
                  </>
                ) : (
                  <p className="text-sm text-muted">No preview for this file type.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
