"use client";

import { useCallback, useMemo, useState } from "react";
import { basename, isWithin, noteTitle } from "@/lib/vault/paths";
import { topmost } from "@/lib/vault/tree-actions";
import { useVault } from "../vault/useVault";
import { Modal } from "./Modal";

/**
 * Confirms deleting files and folders (one, or several chosen in the file tree). If other
 * notes link to what's being deleted, says which, and offers to turn those links into plain text.
 */
export function DeleteDialog({ items: given, onClose }: { items: Array<{ path: string; isFolder: boolean }>; onClose(): void }) {
  const vault = useVault();
  const [unlink, setUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  // What's inside a chosen folder goes with it.
  const items = useMemo(() => {
    const keep = new Set(topmost(given.map((i) => i.path)));
    return given.filter((i) => keep.has(i.path));
  }, [given]);
  const isGone = useCallback(
    (p: string) => items.some((i) => p === i.path || (i.isFolder && isWithin(p, i.path))),
    [items],
  );

  const linking = useMemo(() => {
    const gone = vault.entries.filter((e) => e.kind === "file" && isGone(e.path)).map((e) => e.path);
    const sources = new Set<string>();
    for (const p of gone) for (const b of vault.indexed.links.backlinks(p)) if (!isGone(b.source)) sources.add(b.source);
    return [...sources].sort();
  }, [vault.entries, vault.indexed, isGone]);

  const single = items.length === 1 ? items[0] : null;
  const folders = items.filter((i) => i.isFolder).length;
  const remove = async () => {
    setBusy(true);
    if (unlink) {
      for (const [source, text] of vault.links.unlinkTo(isGone)) await vault.writeNote(source, text);
    }
    for (const i of items) await vault.remove(i.path);
    onClose();
  };

  return (
    <Modal label={single ? (single.isFolder ? "Delete folder" : "Delete file") : `Delete ${items.length} items`} onClose={onClose}>
      {single ? (
        <p className="text-sm">
          Delete{" "}
          {single.isFolder ? (
            <>
              the folder <strong>{basename(single.path)}</strong> and everything in it
            </>
          ) : (
            <strong>{basename(single.path)}</strong>
          )}
          ? This can&apos;t be undone.
        </p>
      ) : (
        <>
          <p className="text-sm">
            Delete these {items.length} items{folders ? ` (${folders === 1 ? "a folder" : `${folders} folders`} with everything in ${folders === 1 ? "it" : "them"})` : ""}? This can&apos;t be
            undone.
          </p>
          <ul aria-label="To delete" className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-sm text-muted">
            {items.map((i) => (
              <li key={i.path} className="truncate">
                {i.path}
                {i.isFolder ? "/" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {linking.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3 text-sm">
          <p className="font-medium">
            {linking.length === 1 ? "1 note links" : `${linking.length} notes link`}{" "}
            {single ? (single.isFolder ? "into it" : "here") : "to them"}:
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
            <legend className="sr-only">What to do with links to {single ? "it" : "them"}</legend>
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
