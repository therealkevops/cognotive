"use client";

import { X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { collectPropertyInfo, kindOf, type PropertyType } from "@/lib/editor/properties";
import { valueText } from "@/lib/links/property-query";
import { displayName } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

/**
 * Properties of many files at once, as a table: a row per file, a column per
 * property. Edit any cell, set or clear a property for every row, or add a
 * column. Changes are written into each file (attachments: their properties file).
 */
export function PropertyTable({ paths, onClose, onOpen }: { paths: string[]; onClose(): void; onOpen(path: string): void }) {
  const vault = useVault();
  const types = vault.settings.propertyTypes;
  const info = useMemo(
    () => collectPropertyInfo(vault.links, types),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion, types],
  );
  const props = (p: string) => vault.links.get(p)?.properties ?? {};
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const columns = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of paths) for (const k of Object.keys(vault.links.get(p)?.properties ?? {})) count.set(k, (count.get(k) ?? 0) + 1);
    const cols = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    return [...cols, ...added.filter((k) => !count.has(k))];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [paths, vault.links, vault.indexVersion, added]);
  const [newColumn, setNewColumn] = useState("");
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const write = async (path: string, key: string, value: unknown) => {
    await vault.setProperty(path, key, value);
  };
  const writeAll = async (key: string, value: unknown) => {
    setBusy(true);
    try {
      for (const p of paths) await vault.setProperty(p, key, value);
    } finally {
      setBusy(false);
    }
  };

  const addColumn = () => {
    const k = newColumn.trim();
    if (!/^[A-Za-z][\w-]*$/.test(k)) return;
    if (!columns.includes(k)) setAdded((a) => [...a, k]);
    setNewColumn("");
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit properties"
        className="dialog-panel flex max-h-[85vh] max-w-6xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-2xl">Edit properties</h2>
            <p className="text-sm text-muted">
              {paths.length} {paths.length === 1 ? "file" : "files"}. Changes are saved as you leave each cell.
              {busy && " Saving…"}
            </p>
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addColumn();
            }}
          >
            <input
              className="input w-44 py-1 text-sm"
              aria-label="Add a property column"
              placeholder="Add property…"
              list={`${listId}-names`}
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
            />
            <datalist id={`${listId}-names`}>
              {info.keys.map((k) => (
                <option key={k.key} value={k.key} />
              ))}
            </datalist>
            <button type="submit" className="button-secondary py-1 text-sm">
              Add
            </button>
          </form>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-5">
          {columns.length === 0 ? (
            <p className="py-6 text-sm text-muted">None of these files has properties yet. Add one above.</p>
          ) : (
            <table className="property-table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  {columns.map((k) => (
                    <th key={k} scope="col">
                      <span className="font-mono">{k}</span>
                      {kindOf(k, info) && <span className="ml-1.5 font-normal text-muted">{kindOf(k, info)}</span>}
                    </th>
                  ))}
                </tr>
                <tr className="property-table-fill">
                  <th scope="row" className="font-normal text-muted">
                    Set for all
                  </th>
                  {columns.map((k) => (
                    <td key={k}>
                      <div className="flex items-center gap-1">
                        <Cell
                          label={`${k} for all files`}
                          kind={kindOf(k, info)}
                          value={undefined}
                          placeholder="Set all…"
                          suggestions={k === "tags" ? info.tags : info.values(k)}
                          onCommit={(v) => v !== undefined && void writeAll(k, v)}
                        />
                        <button
                          type="button"
                          className="icon-button h-6 w-6 shrink-0"
                          aria-label={`Remove ${k} from all files`}
                          title={`Remove ${k} from all ${paths.length} files`}
                          onClick={() => void writeAll(k, undefined)}
                        >
                          <X size={12} aria-hidden />
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paths.map((p) => (
                  <tr key={p}>
                    <th scope="row">
                      <button
                        type="button"
                        className="max-w-[14rem] truncate text-left font-medium hover:text-accent"
                        title={p}
                        onClick={() => {
                          onClose();
                          onOpen(p);
                        }}
                      >
                        {displayName(p)}
                      </button>
                    </th>
                    {columns.map((k) => (
                      <td key={k}>
                        <Cell
                          label={`${k} of ${displayName(p)}`}
                          kind={kindOf(k, info)}
                          value={props(p)[k]}
                          suggestions={k === "tags" ? info.tags : info.values(k)}
                          onCommit={(v) => void write(p, k, v)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/** One editable value. Lists are typed as "a, b"; an empty box removes the property. */
function Cell({
  label,
  kind,
  value,
  placeholder,
  suggestions,
  onCommit,
}: {
  label: string;
  kind: PropertyType | undefined;
  value: unknown;
  placeholder?: string;
  suggestions: string[];
  onCommit(value: unknown): void;
}) {
  const listId = useId();
  const isList = kind === "list" || Array.isArray(value);
  const isBool = kind === "boolean" || typeof value === "boolean";
  if (isBool && placeholder === undefined) {
    const on = value === true || /^(true|yes)$/i.test(String(value ?? ""));
    return <input type="checkbox" aria-label={label} checked={on} onChange={(e) => onCommit(e.target.checked)} />;
  }
  const text = value === undefined || value === null ? "" : isList ? valueText(value) : valueText(value);
  const parse = (raw: string): unknown => {
    const v = raw.trim();
    if (!v) return undefined;
    if (isList) return v.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
    if (isBool) return /^(true|yes|1)$/i.test(v);
    if (kind === "number" && !isNaN(Number(v))) return Number(v);
    return v;
  };
  return (
    <>
      <input
        // Reset when the stored value changes (after a save, or "Set for all").
        key={text}
        type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
        className="property-table-input"
        aria-label={label}
        placeholder={placeholder ?? (isList ? "a, b" : "")}
        defaultValue={text}
        list={suggestions.length && kind !== "date" ? listId : undefined}
        onBlur={(e) => {
          const v = e.target.value;
          if (placeholder !== undefined) {
            if (v.trim()) {
              onCommit(parse(v));
              e.target.value = "";
            }
            return;
          }
          if (v !== text) onCommit(parse(v));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = placeholder !== undefined ? "" : text;
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
      {suggestions.length > 0 && kind !== "date" && (
        <datalist id={listId}>
          {suggestions.slice(0, 50).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}
