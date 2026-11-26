"use client";

import { useState } from "react";
import { writePref } from "@/lib/prefs";
import { LocalStore } from "@/lib/vault/local-store";
import { mergeInto } from "@/lib/vault/merge";
import type { VaultConfig } from "@/lib/vault/registry";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { Field } from "./repo-fields";

/** Sent on `window` with a sentence for the workspace to show (see Workspace). */
export const NOTICE_EVENT = "noted-notice";

/** A repository's name as a folder name (no slashes or characters a name can't have). */
const folderName = (name: string) => name.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/^\.+/, "").trim() || "Merged";

/**
 * Merges one repository into another: its files are copied in, under a folder named after it
 * or at the top level. Nothing there is overwritten (same files are skipped, clashing names get
 * a number), the source's settings stay behind, and a repository synced with GitHub sends the
 * new files on its next sync. The source can then be removed from this browser.
 */
export function MergeVault({ source, onDone }: { source: VaultConfig; onDone(): void }) {
  const { vaults, active, switchTo, remove } = useVaults();
  const vault = useVault();
  const others = vaults.filter((v) => v.id !== source.id);
  // A repository synced with GitHub is the likely destination.
  const [targetId, setTargetId] = useState(() => (others.find((v) => v.kind === "github") ?? others[0])?.id ?? "");
  const [placement, setPlacement] = useState<"folder" | "top">("folder");
  const [folder, setFolder] = useState(() => folderName(source.name));
  const [removeSource, setRemoveSource] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = others.find((v) => v.id === targetId);

  const run = async () => {
    if (!target) return;
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      // The open repository's latest edits are saved first.
      if (source.id === active.id) await vault.flush();
      const src = new LocalStore(source.id);
      const dst = new LocalStore(target.id);
      let r;
      try {
        r = await mergeInto(src, dst, placement === "folder" ? folderName(folder) : "", (done, total) => setProgress({ done, total }));
      } finally {
        await Promise.all([src.close(), dst.close()]);
      }
      const summary =
        `Merged “${source.name}” into “${target.name}”: ${r.added} ${r.added === 1 ? "file" : "files"} added` +
        (r.renamed ? `, ${r.renamed} under new names because the name was taken` : "") +
        (r.skipped ? `, ${r.skipped} already there` : "") +
        "." +
        (target.kind === "github" ? " They go to GitHub with its next sync." : "");
      if (target.id === active.id) {
        await vault.reload(r.paths);
        // Removing the source takes this form away with its row: say it in the workspace.
        if (removeSource) window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: summary }));
        else setResult(summary);
      } else {
        // Opening it reloads the workspace (and closes Settings): say so there.
        writePref("importNotice", summary);
      }
      if (removeSource) await remove(source.id);
      if (target.id !== active.id) switchTo(target.id);
    } catch (e) {
      setError(`The merge stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  if (result) {
    return (
      <div className="mt-3 space-y-3 rounded-lg bg-surface p-4 text-sm">
        <p role="status">{result}</p>
        <div className="flex justify-end">
          <button type="button" className="button-secondary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      aria-label={`Merge ${source.name}`}
      className="mt-3 space-y-4 rounded-lg bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!progress) void run();
      }}
    >
      <p className="text-sm text-muted">
        Copies every note, drawing and attachment in “{source.name}” into another repository. Nothing there is overwritten: files that are
        the same are skipped, and one whose name is taken comes in under a new name. “{source.name}”&apos;s own settings stay behind.
      </p>
      <Field label="Merge into">
        <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {others.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.kind === "github" ? ` (GitHub: ${v.owner}/${v.repo})` : " (this browser)"}
            </option>
          ))}
        </select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Where</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="placement" checked={placement === "folder"} onChange={() => setPlacement("folder")} />
          In a folder
          <input
            aria-label="Folder name"
            className="input ml-1 w-48 py-1"
            value={folder}
            disabled={placement !== "folder"}
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="placement" checked={placement === "top"} onChange={() => setPlacement("top")} />
          At the top level, alongside what&apos;s there
        </label>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={removeSource} onChange={(e) => setRemoveSource(e.target.checked)} />
        <span>
          Then remove “{source.name}” from this browser
          <span className="block text-xs text-muted">
            {source.kind === "github" ? `Its notes stay in ${source.owner}/${source.repo} on GitHub.` : "Its notes will only be in the repository you merge into."}
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {progress ? (
        <p role="status" aria-label="Merging" className="text-sm">
          Copying {Math.min(progress.done + 1, progress.total)} of {progress.total} files…
        </p>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!target || (placement === "folder" && !folderName(folder))}>
            Merge into “{target?.name ?? "…"}”
          </button>
        </div>
      )}
    </form>
  );
}
