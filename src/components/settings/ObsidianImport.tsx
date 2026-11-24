"use client";

import { FolderInput } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { importInto, obsidianSettings, settingsFile, vaultFolder, type VaultFolder } from "@/lib/import/obsidian";
import { writePref } from "@/lib/prefs";
import { formatBytes, storageStatus } from "@/lib/storage-safety";
import { LocalStore } from "@/lib/vault/local-store";
import { isBinary, isCanvas, isDrawing, isNote } from "@/lib/vault/paths";
import { newVaultId } from "@/lib/vault/registry";
import type { VaultSettings } from "@/lib/vault/settings";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { Field } from "./repo-fields";

/** What carried-over settings are called, for the summary. */
const SETTING_NAMES: Partial<Record<keyof VaultSettings, string>> = {
  attachmentFolder: "attachment folder",
  linkFormat: "link style",
  newNoteLocation: "where new notes go",
  dailyFolder: "daily notes folder",
  dailyFormat: "daily note names",
  dailyTemplate: "daily note template",
  templateFolder: "templates folder",
};

interface Picked {
  vault: VaultFolder;
  settings: Partial<VaultSettings>;
  bytes: number;
  free?: number;
}

async function readJson(file: File | undefined): Promise<unknown> {
  if (!file) return undefined;
  try {
    return JSON.parse(await file.text());
  } catch {
    return undefined;
  }
}

/**
 * Imports an Obsidian vault from a folder on this computer: into a new repository named after
 * it (with Obsidian's attachment, link, new-note, daily-note and template settings), or into
 * the open one. Obsidian's own folders (.obsidian, .trash) and .git are left out.
 */
export function ObsidianImport() {
  const { add, active } = useVaults();
  const vault = useVault();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [name, setName] = useState("");
  const [into, setInto] = useState<"new" | "this">("new");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // React doesn't know the folder-picking attributes.
  useEffect(() => {
    input.current?.setAttribute("webkitdirectory", "");
    input.current?.setAttribute("directory", "");
  }, []);

  const choose = async (list: FileList) => {
    setError(null);
    setResult(null);
    const files = [...list].map((file) => ({ relativePath: file.webkitRelativePath || file.name, file }));
    const v = vaultFolder(files);
    if (!v.files.length) {
      setError("That folder has no notes or files to import.");
      return;
    }
    const settings = obsidianSettings({
      app: await readJson(v.config.get("app.json")),
      daily: await readJson(v.config.get("daily-notes.json")),
      templates: await readJson(v.config.get("templates.json")),
    });
    const status = await storageStatus();
    setPicked({
      vault: v,
      settings,
      bytes: v.files.reduce((n, f) => n + f.file.size, 0),
      free: status.quota && status.usage !== undefined ? status.quota - status.usage : undefined,
    });
    setName(v.name || "Obsidian vault");
    setInto("new");
  };

  const run = async () => {
    if (!picked) return;
    setProgress({ done: 0, total: picked.vault.files.length });
    try {
      const report = (done: number, total: number) => setProgress({ done, total });
      if (into === "new") {
        const id = newVaultId("local");
        const store = new LocalStore(id);
        try {
          await importInto(store, picked.vault.files, settingsFile(picked.settings), isBinary, report);
        } finally {
          await store.close();
        }
        // Opening the new repository reloads the workspace (and closes Settings): say so there.
        writePref("importNotice", `Imported ${picked.vault.files.length} files from Obsidian into “${name.trim()}”.`);
        add({ id, name: name.trim() || picked.vault.name, kind: "local" });
      } else {
        const r = await vault.importFiles(new Map(picked.vault.files.map((f) => [f.path, f.file])), report);
        setResult(
          `Imported ${r.added} ${r.added === 1 ? "file" : "files"} into “${active.name}”` +
            (r.renamed ? `, ${r.renamed} renamed because a different file had the same name` : "") +
            (r.skipped ? `, ${r.skipped} already here` : "") +
            ".",
        );
      }
      setPicked(null);
    } catch (e) {
      setError(`The import stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
    }
  };

  const counts = picked && {
    notes: picked.vault.files.filter((f) => isNote(f.path) && !isDrawing(f.path)).length,
    drawings: picked.vault.files.filter((f) => isDrawing(f.path) || isCanvas(f.path)).length,
    attachments: picked.vault.files.filter((f) => isBinary(f.path)).length,
  };
  const carried = picked ? (Object.keys(picked.settings) as Array<keyof VaultSettings>).flatMap((k) => (SETTING_NAMES[k] ? [SETTING_NAMES[k]!] : [])) : [];
  const tooBig = !!picked && picked.free !== undefined && picked.bytes > picked.free;

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Choose an Obsidian vault folder"
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) void choose(list);
          e.target.value = "";
        }}
      />
      {!picked && !progress && (
        <button type="button" className="button-secondary" onClick={() => input.current?.click()}>
          <FolderInput size={15} aria-hidden /> Import an Obsidian vault
        </button>
      )}
      {(result || error) && !picked && !progress && (
        <p role={error ? "alert" : "status"} className={`basis-full text-sm ${error ? "text-red-600 dark:text-red-400" : "text-muted"}`}>
          {error ?? result}
        </p>
      )}
      {picked && counts && (
        <form
          aria-label="Import an Obsidian vault"
          className="basis-full space-y-4 rounded-xl border border-border p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <h4 className="font-semibold tracking-tight text-lg">Import “{picked.vault.name}”</h4>
          <p className="text-sm text-muted">
            {counts.notes} {counts.notes === 1 ? "note" : "notes"}, {counts.drawings} {counts.drawings === 1 ? "drawing or canvas" : "drawings and canvases"},{" "}
            {counts.attachments} {counts.attachments === 1 ? "attachment" : "attachments"}: {formatBytes(picked.bytes)}. Obsidian&apos;s settings folder,
            its trash and any .git folder are left out.
          </p>
          {tooBig && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              That&apos;s more than the browser has room for (about {formatBytes(picked.free!)} free). Free up space in Storage first, or connect GitHub
              and sync the vault there instead.
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Import into</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="into" className="mt-0.5" checked={into === "new"} onChange={() => setInto("new")} />
              <span>
                A new repository
                {carried.length > 0 && <span className="block text-xs text-muted">With the vault&apos;s {carried.join(", ")}.</span>}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="into" className="mt-0.5" checked={into === "this"} onChange={() => setInto("this")} />
              <span>
                This repository, “{active.name}”
                <span className="block text-xs text-muted">Its own settings are kept; a file with the same name as one here is added under a new name.</span>
              </span>
            </label>
          </fieldset>
          {into === "new" && (
            <Field label="Name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="button-secondary" onClick={() => setPicked(null)}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={into === "new" && !name.trim()}>
              Import {picked.vault.files.length} {picked.vault.files.length === 1 ? "file" : "files"}
            </button>
          </div>
        </form>
      )}
      {progress && (
        <div role="status" aria-label="Importing" className="basis-full space-y-2 rounded-xl border border-border p-5 text-sm">
          <p>
            Importing {Math.min(progress.done + 1, progress.total)} of {progress.total} files…
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        </div>
      )}
    </>
  );
}
