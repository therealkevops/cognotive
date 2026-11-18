"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { collectPropertyInfo, kindOf, PROPERTY_DOCS, PROPERTY_TYPES, type PropertyType } from "@/lib/editor/properties";
import { useVault } from "../vault/useVault";
import { useAiActions } from "../ai/useAsk";
import { displayName, isNote } from "@/lib/vault/paths";

/**
 * Every property used in the repository, with how many files use it and its
 * most common values. A property can be renamed or deleted everywhere, given
 * a type, or used to find the files that have it.
 */
export function PropertiesPanel({
  onSearch,
  onRename,
  onDelete,
  onTable,
}: {
  onSearch(query: string): void;
  /** Opens the files that have a property as a table, to edit them together. */
  onTable?(key: string): void;
  /** Renames everywhere; reports files changed, and files left as they were (they already had the new name). */
  onRename(from: string, to: string): Promise<{ changed: number; clashes: number }>;
  onDelete(key: string): Promise<number>;
}) {
  const vault = useVault();
  const aiAction = useAiActions();
  const notePath = vault.active?.path && isNote(vault.active.path) ? vault.active.path : null;
  const suggest = aiAction && notePath && (
    <button
      type="button"
      className="button-secondary mx-2 mb-2 w-[calc(100%-1rem)] px-2 py-1 text-xs"
      title="The AI proposes tags and properties for the open note, using the names and values already in use"
      onClick={() => aiAction({ kind: "suggest-properties", path: notePath })}
    >
      <Sparkles size={12} aria-hidden />
      <span className="truncate">Suggest for {displayName(notePath)} with AI</span>
    </button>
  );
  const types = vault.settings.propertyTypes;
  const info = useMemo(
    () => collectPropertyInfo(vault.links, types),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion, types],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const setType = (key: string, type: PropertyType | "") => {
    const next = { ...types };
    if (type) next[key] = type;
    else delete next[key];
    void vault.updateSettings({ propertyTypes: next });
  };

  const rename = async (from: string) => {
    const to = newName.trim();
    if (!/^[A-Za-z][\w-]*$/.test(to)) return setMessage("Use letters, numbers, - and _, starting with a letter.");
    if (to === from) return setRenaming(null);
    const { changed, clashes } = await onRename(from, to);
    if (types[from]) {
      const next = { ...types, [to]: types[from] };
      delete next[from];
      void vault.updateSettings({ propertyTypes: next });
    }
    setRenaming(null);
    setOpen(to);
    setMessage(
      `Renamed in ${changed} ${changed === 1 ? "file" : "files"}.` +
        (clashes ? ` ${clashes} already had ${to} and ${clashes === 1 ? "was" : "were"} left as ${clashes === 1 ? "it was" : "they were"}.` : ""),
    );
  };

  if (info.keys.length === 0) {
    return (
      <section aria-label="Properties" className="text-sm text-muted">
        <h2 className="mb-2 px-2 text-xs font-medium">Properties</h2>
        {suggest}
        <p className="px-2">No properties yet. Add some to a note with the command “Add a property”.</p>
      </section>
    );
  }

  return (
    <section aria-label="Properties" className="flex h-full flex-col text-sm">
      <h2 className="mb-2 px-2 text-xs font-medium text-muted">Properties</h2>
      {suggest}
      {message && (
        <p role="status" className="mx-2 mb-2 rounded-md bg-accent/10 px-2 py-1 text-xs">
          {message}
        </p>
      )}
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
        {info.keys.map(({ key, count }) => {
          const builtIn = PROPERTY_DOCS[key];
          const kind = kindOf(key, info);
          const expanded = open === key;
          const values = info.values(key).slice(0, 8);
          return (
            <li key={key} className="mb-0.5">
              <button
                type="button"
                aria-expanded={expanded}
                className="nav-item w-full"
                onClick={() => {
                  setOpen(expanded ? null : key);
                  setMessage(null);
                }}
              >
                <ChevronRight size={12} aria-hidden className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
                <span className="min-w-0 flex-1 truncate text-left font-mono text-[0.85em]">{key}</span>
                {kind && <span className="text-[11px] text-muted">{kind}</span>}
                <span className="text-xs text-muted tabular-nums">{count}</span>
              </button>
              {expanded && (
                <div className="mx-2 mt-1 mb-2 space-y-2 rounded-lg border border-border p-2 text-xs" aria-label={`${key} details`} role="group">
                  {builtIn && <p className="text-muted">{builtIn.doc}</p>}
                  <label className="flex items-center gap-2">
                    <span className="text-muted">Type</span>
                    <select
                      className="input py-0.5 text-xs"
                      value={builtIn ? builtIn.kind : (types[key] ?? "")}
                      disabled={!!builtIn}
                      onChange={(e) => setType(key, e.target.value as PropertyType | "")}
                    >
                      {!builtIn && <option value="">Not set</option>}
                      {PROPERTY_TYPES.map(([t, label]) => (
                        <option key={t} value={t}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {values.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {values.map((v) => (
                        <button
                          key={v}
                          type="button"
                          className="properties-chip px-2"
                          title={`Find files with ${key}: ${v}`}
                          onClick={() => onSearch(`[${key}:${v}]`)}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="button-secondary px-2 py-0.5 text-xs" onClick={() => onSearch(`[${key}]`)}>
                      Show {count} {count === 1 ? "file" : "files"}
                    </button>
                    {onTable && (
                      <button type="button" className="button-secondary px-2 py-0.5 text-xs" onClick={() => onTable(key)}>
                        Edit as table
                      </button>
                    )}
                    {!builtIn && (
                      <button
                        type="button"
                        className="button-secondary px-2 py-0.5 text-xs"
                        onClick={() => {
                          setRenaming(key);
                          setNewName(key);
                          setMessage(null);
                        }}
                      >
                        Rename…
                      </button>
                    )}
                    <button
                      type="button"
                      className="button-secondary px-2 py-0.5 text-xs text-[#c2412d]"
                      onClick={() => setConfirming(key)}
                    >
                      Delete…
                    </button>
                  </div>
                  {renaming === key && (
                    <form
                      className="flex gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rename(key);
                      }}
                    >
                      <input
                        className="input min-w-0 flex-1 py-0.5 text-xs"
                        aria-label={`New name for ${key}`}
                        value={newName}
                        autoFocus
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      />
                      <button type="submit" className="button-primary px-2 py-0.5 text-xs">
                        Rename everywhere
                      </button>
                    </form>
                  )}
                  {confirming === key && (
                    <div role="alertdialog" aria-label={`Delete ${key}`} className="rounded-md bg-[#c2412d]/10 p-2">
                      <p>
                        Remove {key} from {count} {count === 1 ? "file" : "files"}? Their other properties stay.
                      </p>
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          className="button-primary px-2 py-0.5 text-xs"
                          onClick={async () => {
                            const n = await onDelete(key);
                            setConfirming(null);
                            setOpen(null);
                            setMessage(`Removed ${key} from ${n} ${n === 1 ? "file" : "files"}.`);
                          }}
                        >
                          Delete everywhere
                        </button>
                        <button type="button" className="button-secondary px-2 py-0.5 text-xs" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
