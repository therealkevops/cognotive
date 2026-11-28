"use client";

import { Check, ChevronRight, FilePlus, Pencil, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { chatStore } from "@/lib/ai/chat-store";
import { lineDiff, rebase, type Proposal } from "@/lib/ai/proposals";
import { displayName } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

/**
 * Applies a proposal through the vault, so it's saved, indexed and synced like
 * a typed edit. Text changes are merged onto edits made since they were
 * proposed; when they clash, the proposal fails and says so.
 */
export function useApplyProposal() {
  const vault = useVault();
  return useCallback(
    async (p: Proposal): Promise<boolean> => {
      const fail = (error: string) => {
        chatStore.updateProposal(p.id, { status: "failed", error });
        return false;
      };
      try {
        if (p.kind === "property") {
          if (!vault.exists(p.path)) return fail("The file no longer exists.");
          await vault.setProperty(p.path, p.property!.key, p.property!.value);
        } else {
          const current = !vault.exists(p.path) ? undefined : vault.textOf(p.path);
          const text = rebase(p, current);
          if (text === null) {
            return fail(p.before === null ? "A file with that name exists now." : "The note changed in the same place since. Ask again to redo this change.");
          }
          if (p.before === null) await vault.writeFile(p.path, text);
          else await vault.writeFile(p.path, text);
        }
        chatStore.updateProposal(p.id, { status: "applied", error: undefined });
        return true;
      } catch (e) {
        return fail((e as Error).message || "Couldn't save the change.");
      }
    },
    [vault],
  );
}

/** The changes proposed in one answer: each with its diff, to apply, edit or reject; and Apply all. */
export function ProposalList({ proposals, onOpen }: { proposals: Proposal[]; onOpen(path: string): void }) {
  const apply = useApplyProposal();
  const pending = proposals.filter((p) => p.status === "pending");
  return (
    <section aria-label="Proposed changes" className="mt-2 rounded-lg border border-border">
      <header className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs">
        <span className="font-medium">
          {proposals.length} proposed {proposals.length === 1 ? "change" : "changes"}
        </span>
        <span className="text-muted">{pending.length ? `${pending.length} to review` : "all reviewed"}</span>
        {pending.length > 1 && (
          <button
            type="button"
            className="button-primary ml-auto px-2 py-0.5 text-xs"
            onClick={async () => {
              for (const p of pending) await apply(chatStore.proposals().find((x) => x.id === p.id) ?? p);
            }}
          >
            Apply all
          </button>
        )}
      </header>
      <ul className="divide-y divide-border">
        {proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p} onApply={() => void apply(p)} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function ProposalCard({ proposal: p, onApply, onOpen }: { proposal: Proposal; onApply(): void; onOpen(path: string): void }) {
  const [open, setOpen] = useState(p.status === "pending");
  const [editing, setEditing] = useState<string | null>(null);
  const diff = useMemo(() => lineDiff(p.before ?? "", p.after), [p.before, p.after]);
  const Icon = p.kind === "create" ? FilePlus : Pencil;
  return (
    <li className="px-2.5 py-2" aria-label={p.summary}>
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          className="mt-0.5 shrink-0 text-muted hover:text-foreground"
          aria-label={open ? "Hide changes" : "Show changes"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight size={12} aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <Icon size={13} aria-hidden className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-medium">{p.summary}</p>
          <button type="button" className="truncate text-muted hover:text-accent" title={p.path} onClick={() => onOpen(p.path)} disabled={p.kind === "create" && p.status !== "applied"}>
            {p.path}
          </button>
        </div>
        <Status p={p} />
      </div>
      {open && editing === null && (
        <pre className="proposal-diff mt-1.5" aria-label={`Changes to ${displayName(p.path)}`}>
          {diff.map((l, i) =>
            l.kind === "skip" ? (
              <span key={i} className="proposal-skip">
                ⋯ {l.count} unchanged {l.count === 1 ? "line" : "lines"}
              </span>
            ) : (
              <span key={i} className={`proposal-${l.kind}`}>
                {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                {l.text || " "}
              </span>
            ),
          )}
        </pre>
      )}
      {editing !== null && (
        <textarea
          aria-label={`Edit the proposed text of ${displayName(p.path)}`}
          className="input mt-1.5 h-48 w-full font-mono text-xs"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
        />
      )}
      {p.error && (
        <p role="alert" className="mt-1 text-xs text-[#c2412d]">
          {p.error}
        </p>
      )}
      {(p.status === "pending" || p.status === "failed") && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {editing === null ? (
            <>
              {p.status === "pending" && (
                <button type="button" className="button-primary px-2 py-0.5 text-xs" onClick={onApply}>
                  Apply
                </button>
              )}
              {p.kind !== "property" && p.status === "pending" && (
                <button type="button" className="button-secondary px-2 py-0.5 text-xs" onClick={() => {
                    setOpen(true);
                    setEditing(p.after);
                  }}>
                  Edit
                </button>
              )}
              <button
                type="button"
                className="button-secondary px-2 py-0.5 text-xs"
                onClick={() => chatStore.updateProposal(p.id, { status: "rejected" })}
              >
                {p.status === "failed" ? "Dismiss" : "Reject"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button-primary px-2 py-0.5 text-xs"
                onClick={() => {
                  chatStore.updateProposal(p.id, { after: editing });
                  setEditing(null);
                }}
              >
                Done editing
              </button>
              <button type="button" className="button-secondary px-2 py-0.5 text-xs" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Status({ p }: { p: Proposal }) {
  if (p.status === "applied")
    return (
      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-accent">
        <Check size={11} aria-hidden /> Applied
      </span>
    );
  if (p.status === "rejected")
    return (
      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted">
        <X size={11} aria-hidden /> Rejected
      </span>
    );
  if (p.status === "failed") return <span className="shrink-0 text-[11px] text-[#c2412d]">Not applied</span>;
  return null;
}
