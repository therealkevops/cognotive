"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { activityWeeks, scoreVerdict, vaultHealth } from "@/lib/links/health";
import { displayName, dirname, isWithin } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

type Tab = "broken" | "orphans" | "deadEnds" | "hubs" | "stale";

/**
 * Repository health: what the link graph says needs attention, as lists you can
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

  const n = health.stats.notes;
  const tabs: Array<{ id: Tab; label: string; count: number; hint: string; tone: Tone; detail: string; share?: number }> = [
    {
      id: "broken",
      label: "Broken links",
      count: health.broken.length,
      hint: "Links to notes that don't exist yet.",
      tone: "bad",
      detail: health.stats.brokenRefs === 1 ? "1 link" : `${health.stats.brokenRefs} links`,
      share: n ? health.stats.brokenRefs / n : 0,
    },
    {
      id: "orphans",
      label: "Orphans",
      count: health.orphans.length,
      hint: "Notes nothing links to. Link them from somewhere, or let them go.",
      tone: "poor",
      detail: percent(health.orphans.length, n) + " of notes",
      share: n ? health.orphans.length / n : 0,
    },
    {
      id: "deadEnds",
      label: "Dead ends",
      count: health.deadEnds.length,
      hint: "Notes that don't link anywhere. Worth connecting to related notes.",
      tone: "fair",
      detail: percent(health.deadEnds.length, n) + " of notes",
      share: n ? health.deadEnds.length / n : 0,
    },
    {
      id: "hubs",
      label: "Hubs",
      count: health.hubs.length,
      hint: "The notes most others link to: the backbone of the repository.",
      tone: "good",
      detail: health.hubs[0] ? `Top: ${displayName(health.hubs[0].path)}` : "None yet",
    },
    {
      id: "stale",
      label: "Stale hubs",
      count: health.stale.length,
      hint: "Notes three or more others rely on that haven't changed in six months. Worth a review.",
      tone: "old",
      detail: health.stale.length ? "Worth a review" : "All fresh",
    },
  ];
  const current = tabs.find((t) => t.id === tab)!;
  const verdict = scoreVerdict(health.score);
  const weeks = useMemo(() => activityWeeks(vault.entries.filter((e) => e.kind === "file").map((e) => e.mtime)), [vault.entries]);

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
        aria-label="Repository health"
        className="dialog-panel flex h-[min(46rem,90vh)] max-w-3xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 pt-5 pb-2">
          <h2 className="min-w-0 flex-1 font-serif text-2xl">Repository health</h2>
          <button type="button" className="icon-button" aria-label="Close repository health" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section aria-label="Summary" className="flex flex-col gap-5 px-6 pt-2 pb-4 md:flex-row md:items-center">
            <div className="flex min-w-0 items-center gap-5">
              <ScoreRing score={health.score} tone={verdict.tone} />
              <div className="min-w-0">
                <p className="font-serif text-xl" data-testid="health-verdict">
                  {verdict.label}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2">
                  <Stat label="Notes" value={n.toLocaleString()} />
                  <Stat label="Links" value={health.stats.links.toLocaleString()} />
                  <Stat label="Per note" value={n ? (health.stats.links / n).toFixed(1) : "0"} />
                  <Stat label="Connected" value={percent(health.stats.connected, n)} />
                </dl>
              </div>
            </div>
            <Activity weeks={weeks} />
          </section>

          <div role="tablist" aria-label="Checks" className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`health-card tone-${t.tone}`}
                onClick={() => setTab(t.id)}
              >
                <span className="text-xs font-medium text-muted">{t.label}</span>
                <span className="health-count">{t.count}</span>
                {t.share !== undefined ? (
                  <span className="health-bar" aria-hidden>
                    <span style={{ width: `${Math.max(t.count ? 4 : 0, Math.min(100, t.share * 100))}%` }} />
                  </span>
                ) : (
                  <span className="health-bar invisible" aria-hidden />
                )}
                <span className="truncate text-[11px] text-muted">{t.detail}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 border-b border-border px-6 py-2.5 text-sm text-muted">{current.hint}</p>
          <ul role="tabpanel" aria-label={current.label} className="divide-y divide-border px-4 py-1">
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
    </div>
  );
}

type Tone = "good" | "fair" | "poor" | "bad" | "old";

const percent = (part: number, whole: number) => `${whole ? Math.round((100 * part) / whole) : 0}%`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums leading-tight">{value}</dd>
    </div>
  );
}

/** The score as a ring that fills up to it. */
function ScoreRing({ score, tone }: { score: number; tone: Tone }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div className={`health-ring tone-${tone}`} role="img" aria-label={`Health score ${score} out of 100`}>
      <svg viewBox="0 0 108 108" width="108" height="108" aria-hidden>
        <circle cx="54" cy="54" r={r} className="health-ring-track" />
        <circle
          cx="54"
          cy="54"
          r={r}
          className="health-ring-value"
          strokeDasharray={c}
          style={{ ["--ring-full" as string]: `${c}`, strokeDashoffset: c * (1 - score / 100) }}
        />
      </svg>
      <span className="health-ring-score" aria-hidden>
        {score}
      </span>
    </div>
  );
}

/** A heatmap of the days files were last changed, like a contributions graph. */
function Activity({ weeks }: { weeks: ReturnType<typeof activityWeeks> }) {
  const days = weeks.flat().filter((d): d is { day: number; count: number } => !!d);
  const total = days.reduce((n, d) => n + d.count, 0);
  const max = Math.max(1, ...days.map((d) => d.count));
  const level = (count: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((4 * count) / max)));
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return (
    <figure className="min-w-0 md:ml-auto md:shrink-0">
      <div
        className="health-heatmap"
        role="img"
        aria-label={`${total} ${total === 1 ? "file" : "files"} last changed in the past ${weeks.length} weeks`}
      >
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {week.map((d, i) =>
              d ? (
                <span
                  key={i}
                  className={`health-day level-${level(d.count)}`}
                  title={`${d.count} ${d.count === 1 ? "file" : "files"} last changed ${fmt(d.day)}`}
                />
              ) : (
                <span key={i} className="health-day invisible" />
              ),
            )}
          </div>
        ))}
      </div>
      <figcaption className="mt-1.5 text-xs text-muted">
        When files were last changed, past {weeks.length} weeks · {total} {total === 1 ? "file" : "files"}
      </figcaption>
    </figure>
  );
}
