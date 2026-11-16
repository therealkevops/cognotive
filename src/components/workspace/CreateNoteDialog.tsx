"use client";

import { useMemo, useState } from "react";
import { useVault } from "../vault/useVault";
import { Modal } from "./Modal";

/**
 * Asks before creating the note a link points to, with the name and folder
 * filled in (from the link and the repository's "new notes from links" setting).
 */
export function CreateNoteDialog({
  name: initialName,
  folder: initialFolder,
  onClose,
}: {
  name: string;
  folder: string;
  onClose(): void;
}) {
  const vault = useVault();
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState(initialFolder);
  const folders = useMemo(() => {
    const list = vault.entries
      .filter((e) => e.kind === "folder" && !e.path.split("/").some((seg) => seg.startsWith(".")))
      .map((e) => e.path);
    // The folder may not exist yet (a link to "New/Idea"); it's created with the note.
    if (initialFolder && !list.includes(initialFolder)) list.push(initialFolder);
    return list.sort((a, b) => a.localeCompare(b));
  }, [vault.entries, initialFolder]);

  return (
    <Modal label="Create note" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onClose();
          void vault.createNote(folder, name.trim());
        }}
      >
        <p className="text-sm text-muted">This link points to a note that doesn&apos;t exist yet.</p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input className="input w-full" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Folder</span>
          <select className="input w-full" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">Repository root</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
