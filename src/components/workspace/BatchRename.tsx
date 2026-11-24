"use client";

import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { planRenames, type RenameItem, type RenameRule } from "@/lib/vault/batch-rename";
import { basename } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { Modal } from "./Modal";

type Mode = RenameRule["kind"];

const MODES: Array<[Mode, string]> = [
  ["replace", "Find and replace"],
  ["affix", "Add text"],
  ["number", "Number"],
];

/**
 * Renames several chosen files and folders by one rule (find and replace in their names,
 * text added before or after, or numbered in order), with each new name shown first and any
 * clash named; links to them follow, as for a single rename.
 */
export function BatchRename({ items, onClose, onDone }: { items: RenameItem[]; onClose(): void; onDone(renamed: number): void }) {
  const vault = useVault();
  const [mode, setMode] = useState<Mode>("replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [base, setBase] = useState("");
  const [start, setStart] = useState("1");
  const [busy, setBusy] = useState(false);

  const rule: RenameRule =
    mode === "replace"
      ? { kind: "replace", find, replace, matchCase }
      : mode === "affix"
        ? { kind: "affix", prefix, suffix }
        : { kind: "number", base, start: Math.max(0, Math.floor(Number(start) || 0)) };
  const plan = useMemo(
    () => planRenames(items, rule, vault.exists),
    // The rule is rebuilt each render from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, vault.exists, mode, find, replace, matchCase, prefix, suffix, base, start],
  );
  const changes = plan.filter((p) => p.to !== p.from);
  const problems = plan.filter((p) => p.problem);

  const apply = async () => {
    setBusy(true);
    let renamed = 0;
    // Deepest first: renaming a folder moves what's in it, which may be chosen too.
    const order = [...changes].sort((a, b) => b.path.split("/").length - a.path.split("/").length);
    for (const p of order) if (await vault.rename(p.path, basename(p.target))) renamed++;
    setBusy(false);
    onDone(renamed);
    onClose();
  };

  const field = (label: string, value: string, set: (v: string) => void, opts: { autoFocus?: boolean; placeholder?: string; type?: string } = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        className="input"
        value={value}
        type={opts.type ?? "text"}
        placeholder={opts.placeholder}
        autoFocus={opts.autoFocus}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <Modal label={`Rename ${items.length} items`} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (changes.length && !problems.length && !busy) void apply();
        }}
      >
        <div role="radiogroup" aria-label="How to rename" className="segmented segmented-tight">
          {MODES.map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className="whitespace-nowrap" onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {mode === "replace" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {field("Find", find, setFind, { autoFocus: true })}
            {field("Replace with", replace, setReplace)}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
              Match case
            </label>
          </div>
        )}
        {mode === "affix" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {field("Before the name", prefix, setPrefix, { autoFocus: true, placeholder: "2026 " })}
            {field("After the name", suffix, setSuffix, { placeholder: " (old)" })}
          </div>
        )}
        {mode === "number" && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            {field("Name", base, setBase, { autoFocus: true, placeholder: "Photo" })}
            {field("Start at", start, setStart, { type: "number" })}
            <p className="text-xs text-muted sm:col-span-2">In the order the file tree shows them: “{base.trim() || "Name"} 1”, “{base.trim() || "Name"} 2”…</p>
          </div>
        )}

        <ul aria-label="New names" className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
          {plan.map((p) => (
            <li key={p.path} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-muted">{p.from}</span>
                <ArrowRight size={13} aria-hidden className="shrink-0 text-muted" />
                <span className={`min-w-0 flex-1 truncate ${p.to === p.from ? "text-muted" : p.problem ? "text-red-600 dark:text-red-400" : "font-medium"}`}>
                  {p.to === p.from ? "unchanged" : p.to || "(empty)"}
                </span>
              </div>
              {p.problem && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{p.problem}</p>}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-2">
          {problems.length > 0 && (
            <p role="alert" className="mr-auto text-xs text-red-600 dark:text-red-400">
              {problems.length === 1 ? "1 name needs changing" : `${problems.length} names need changing`} first.
            </p>
          )}
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!changes.length || problems.length > 0 || busy}>
            {busy ? "Renaming…" : `Rename ${changes.length || ""}`.trim()}
          </button>
        </div>
      </form>
    </Modal>
  );
}
