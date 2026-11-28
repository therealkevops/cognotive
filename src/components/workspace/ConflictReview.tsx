"use client";

import { GitMerge } from "lucide-react";
import { useMemo, useState } from "react";
import { conflictPath } from "@/lib/sync/engine";
import { resolveBlocks, reviewBlocks, type Choice, type ConflictRecord } from "@/lib/sync/conflicts";
import { displayName } from "@/lib/vault/paths";
import { useSync } from "../sync/useSync";
import { useVault } from "../vault/useVault";
import { Modal } from "./Modal";

/** Above a file that has conflicts waiting: says so, and opens the review. */
export function ConflictBanner({ path, onReview }: { path: string; onReview(record: ConflictRecord): void }) {
  const { conflicts } = useSync();
  const mine = conflicts.filter((c) => c.path === path);
  if (mine.length === 0) return null;
  return (
    <div role="region" aria-label="Conflict" className="conflict-banner">
      <GitMerge size={15} aria-hidden className="shrink-0" />
      <p className="min-w-0 flex-1">
        {mine[0].kind === "text"
          ? "This note was changed here and on GitHub in the same place. It shows GitHub's version there for now; your version is kept."
          : "This file was changed here and on GitHub. It shows GitHub's version for now; yours is kept."}
      </p>
      <button type="button" className="button-secondary shrink-0 px-2.5 py-1 text-xs" onClick={() => onReview(mine[0])}>
        Review{mine.length > 1 ? ` (${mine.length})` : ""}
      </button>
    </div>
  );
}

const CHOICES: Array<[Choice, string]> = [
  ["current", "Keep GitHub's"],
  ["yours", "Keep yours"],
  ["both", "Keep both"],
];

/**
 * One conflict, side by side: for a note, each place both sides changed, to
 * keep GitHub's lines, yours, or both; for other files, which file to keep.
 */
export function ConflictDialog({ record, onClose }: { record: ConflictRecord; onClose(): void }) {
  const vault = useVault();
  const { resolveConflict } = useSync();
  const exists = vault.exists(record.path);
  const current = vault.textOf(record.path) ?? "";
  const blocks = useMemo(
    () => (record.kind === "text" ? reviewBlocks(record, current) : []),
    // Reviewed against the note as it was when the dialog opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record],
  );
  const clashes = blocks.filter((b) => b.kind === "conflict").length;
  const [choices, setChoices] = useState<Choice[]>(() => Array<Choice>(clashes).fill("current"));
  const title = displayName(record.path);

  const finish = async (write?: () => Promise<void>) => {
    if (write) await write();
    await resolveConflict(record.id);
    onClose();
  };
  const keepBoth = () => vault.writeFile(conflictPath(record.path, new Date(), vault.exists), record.ours);

  // A file that's gone (deleted or renamed since), or one that isn't text: choose a whole file.
  if (record.kind === "file" || !exists) {
    return (
      <Modal label={`Conflict in ${title}`} onClose={onClose}>
        <p className="text-sm text-muted">
          {exists
            ? `${title} was changed here and on GitHub. It shows GitHub's version now; the version from this device is kept until you choose.`
            : `${record.path} has been renamed or deleted since. The version from this device is kept until you choose.`}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {exists && (
            <button type="button" className="button-secondary" onClick={() => void finish()}>
              Keep GitHub&apos;s
            </button>
          )}
          <button type="button" className="button-secondary" onClick={() => void finish(() => vault.writeFile(record.path, record.ours))}>
            {exists ? "Keep yours" : "Restore yours"}
          </button>
          {exists && (
            <button type="button" className="button-secondary" onClick={() => void finish(keepBoth)} title="Saves yours next to it as a copy">
              Keep both
            </button>
          )}
          {!exists && (
            <button type="button" className="button-secondary" onClick={() => void finish()}>
              Discard yours
            </button>
          )}
        </div>
      </Modal>
    );
  }

  if (clashes === 0) {
    return (
      <Modal label={`Conflict in ${title}`} onClose={onClose}>
        <p className="text-sm text-muted">Nothing left to review: {title} already has your changes or GitHub&apos;s in each place they differed.</p>
        <div className="mt-4 flex justify-end">
          <button type="button" className="button-primary" onClick={() => void finish()}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  let n = -1;
  return (
    <Modal label={`Conflict in ${title}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">
            {clashes === 1 ? "One place was" : `${clashes} places were`} changed both here and on GitHub. Everything else is
            already merged. Choose what to keep in each.
          </p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className="button-secondary px-2.5 py-1 text-xs" onClick={() => setChoices(choices.map(() => "current"))}>
            All GitHub&apos;s
          </button>
          <button type="button" className="button-secondary px-2.5 py-1 text-xs" onClick={() => setChoices(choices.map(() => "yours"))}>
            All yours
          </button>
        </div>
      </div>
      <ol className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {blocks.map((b, i) => {
          if (b.kind === "same") return null;
          const k = ++n;
          const before = blocks[i - 1]?.kind === "same" ? (blocks[i - 1] as { lines: string[] }).lines.slice(-2) : [];
          return (
            <li key={i} aria-label={`Conflict ${k + 1}`} className="rounded-xl border border-border p-3">
              {before.some((l) => l.trim()) && <pre className="conflict-context">{before.join("\n")}</pre>}
              <div className="grid gap-2 sm:grid-cols-2">
                <Side label="On GitHub (in the note now)" lines={b.current} chosen={choices[k] !== "yours"} tone="theirs" />
                <Side label="Yours (from this device)" lines={b.yours} chosen={choices[k] !== "current"} tone="yours" />
              </div>
              <div role="radiogroup" aria-label={`Keep for conflict ${k + 1}`} className="segmented conflict-choices mt-2 w-fit">
                {CHOICES.map(([c, label]) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={choices[k] === c}
                    onClick={() => setChoices(choices.map((x, j) => (j === k ? c : x)))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onClose}>
          Later
        </button>
        <button
          type="button"
          className="button-primary"
          onClick={() => void finish(() => vault.writeFile(record.path, resolveBlocks(blocks, choices)))}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}

function Side({ label, lines, chosen, tone }: { label: string; lines: string[]; chosen: boolean; tone: "theirs" | "yours" }) {
  return (
    <figure className={`conflict-side conflict-${tone}${chosen ? "" : " conflict-dropped"}`}>
      <figcaption className="mb-1 text-xs font-medium text-muted">{label}</figcaption>
      <pre>{lines.length && lines.some((l) => l !== "") ? lines.join("\n") : "(nothing)"}</pre>
    </figure>
  );
}
