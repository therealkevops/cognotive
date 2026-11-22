"use client";

import { useCallback, useMemo, useState } from "react";
import { basename, isWithin, noteTitle } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { Modal } from "./Modal";

/**
 * Confirms deleting a file or folder. If other notes link to what's being
 * deleted, says which, and offers to turn those links into plain text.
 */
export function DeleteDialog({ path, isFolder, onClose }: { path: string; isFolder: boolean; onClose(): void }) {
  const vault = useVault();
  const [unlink, setUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const isGone = useCallback((p: string) => p === path || (isFolder && isWithin(p, path)), [path, isFolder]);

  const linking = useMemo(() => {
    const gone = vault.entries.filter((e) => e.kind === "file" && isGone(e.path)).map((e) => e.path);
    const sources = new Set<string>();
    for (const p of gone) for (const b of vault.indexed.links.backlinks(p)) if (!isGone(b.source)) sources.add(b.source);
    return [...sources].sort();
  }, [vault.entries, vault.indexed, isGone]);

  const name = basename(path);
  const remove = async () => {
    setBusy(true);
    if (unlink) {
      for (const [source, text] of vault.links.unlinkTo(isGone)) await vault.writeNote(source, text);
    }
    await vault.remove(path);
    onClose();
  };

  return (
    <Modal label={isFolder ? "Delete folder" : "Delete file"} onClose={onClose}>
      <p className="text-sm">
        Delete {isFolder ? <>the folder <strong>{name}</strong> and everything in it</> : <strong>{name}</strong>}? This
        can&apos;t be undone.
      </p>
      {linking.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3 text-sm">
          <p className="font-medium">
            {linking.length === 1 ? "1 note links" : `${linking.length} notes link`} {isFolder ? "into it" : "here"}:
          </p>
          <ul className="mt-1 mb-2 list-disc pl-5 text-muted">
            {linking.slice(0, 5).map((s) => (
              <li key={s} className="truncate">
                {noteTitle(s)}
              </li>
            ))}
            {linking.length > 5 && <li>and {linking.length - 5} more</li>}
          </ul>
          <fieldset className="space-y-1">
            <legend className="sr-only">What to do with links to it</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="links" className="mt-1" checked={!unlink} onChange={() => setUnlink(false)} />
              <span>Leave the links (they&apos;ll show as not created yet)</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="links" className="mt-1" checked={unlink} onChange={() => setUnlink(true)} />
              <span>Turn the links into plain text</span>
            </label>
          </fieldset>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button-danger"
          disabled={busy}
          autoFocus
          onClick={() => void remove()}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
