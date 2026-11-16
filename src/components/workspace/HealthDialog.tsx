"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { vaultHealth } from "@/lib/links/health";
import { displayName, dirname, isWithin } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

type Tab = "broken" | "orphans" | "deadEnds" | "hubs" | "stale";

/**
 * Vault health: what the link graph says needs attention, as lists you can
 * act on. Clicking a note opens it (and closes this).
 */
export function HealthDialog({
  onClose,
  onCreate,
}: {
  onClose(): void;
  /** Offers to create the missing note `target`, as linked from `from`. */
  onCreate(target: string, from: string): void;
}) {
  const vault = useVault();
  const [tab, setTab] = useState<Tab>("broken");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const health = useMemo(() => {
    const mtimes = new Map(vault.entries.map((e) => [e.path, e.mtime]));
    const s = vault.settings;
    return vaultHealth(vault.links, {
      mtime: (p) => mtimes.get(p),
      // Daily notes and templates are naturally unlinked; leave them out.
      ignore: (p) =>
        (!!s.dailyFolder && isWithin(p, s.dailyFolder)) || (!!s.templateFolder && isWithin(p, s.templateFolder)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [vault.links, vault.indexVersion, vault.entries, vault.settings]);

  const open = (p: string) => {
    onClose();
    void vault.open(p);
  };

  const tabs: Array<{ id: Tab; label: string; count: number; hint: string }> = [
    { id: "broken", label: "Broken links", count: health.broken.length, hint: "Links to notes that don't exist yet." },
    { id: "orphans", label: "Orphans", count: health.orphans.length, hint: "Notes nothing links to. Link them from somewhere, or let them go." },
    { id: "deadEnds", label: "Dead ends", count: health.deadEnds.length, hint: "Notes that don't link anywhere. Worth connecting to related notes." },
    { id: "hubs", label: "Hubs", count: health.hubs.length, hint: "The notes most others link to: the backbone of the vault." },
    { id: "stale", label: "Stale hubs", count: health.stale.length, hint: "Notes three or more others rely on that haven't changed in six months. Worth a review." },
  ];
  const current = tabs.find((t) => t.id === tab)!;

  const row = (key: string, main: ReactNode, sub?: ReactNode, action?: ReactNode) => (
    <li key={key} className="flex items-center gap-3 px-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{main}</div>
        {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      </div>
      {action}
    </li>
  );
  const noteButton = (p: string) => (
    <button type="button" className="font-medium hover:text-accent" onClick={() => open(p)}>
      {displayName(p)}
    </button>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Vault health"
        className="dialog-panel flex h-[min(40rem,85vh)] max-w-3xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-3">
          <h2 className="min-w-0 flex-1 font-serif text-2xl">Vault health</h2>
          <button type="button" className="icon-button" aria-label="Close vault health" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div role="tablist" aria-label="Checks" className="flex gap-1 overflow-x-auto px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className="nav-item shrink-0"
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="rounded bg-foreground/[0.06] px-1.5 text-xs font-normal text-muted">{t.count}</span>
            </button>
          ))}
        </div>
        <p className="border-b border-border px-6 py-3 text-sm text-muted">{current.hint}</p>
        <ul role="tabpanel" aria-label={current.label} className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-4 py-1">
          {current.count === 0 && <li className="px-2 py-6 text-center text-sm text-muted">Nothing here. 🎉</li>}
          {tab === "broken" &&
            health.broken.map((b) =>
              row(
                b.target,
                <span className="text-muted italic">{b.target}</span>,
                <>
                  Linked from{" "}
                  {b.sources.slice(0, 3).map((src, i) => (
                    <span key={src}>
                      {i > 0 && ", "}
                      <button type="button" className="hover:text-accent hover:underline" onClick={() => open(src)}>
                        {displayName(src)}
                      </button>
                    </span>
                  ))}
                  {b.sources.length > 3 && ` and ${b.sources.length - 3} more`}
                </>,
                <button
                  type="button"
                  className="button-secondary shrink-0 px-2.5 py-1 text-xs"
                  aria-label={`Create ${b.target}`}
                  onClick={() => {
                    onClose();
                    onCreate(b.target, b.sources[0]);
                  }}
                >
                  Create
                </button>,
              ),
            )}
          {(tab === "orphans" || tab === "deadEnds") &&
            health[tab].map((p) => row(p, noteButton(p), dirname(p) || undefined))}
          {tab === "hubs" &&
            health.hubs.map((h) => row(h.path, noteButton(h.path), `${h.links} notes link here`))}
          {tab === "stale" &&
            health.stale.map((h) =>
              row(h.path, noteButton(h.path), `${h.links} notes link here · last changed ${new Date(h.mtime).toLocaleDateString()}`),
            )}
        </ul>
      </div>
    </div>
  );
}
