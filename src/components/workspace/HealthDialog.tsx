"use client";

import { Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatLink } from "@/lib/links/format";
import { addToHub, hubsFor, pinnedHubs } from "@/lib/links/hubs";
import { activityWeeks, healthIgnored, scoreVerdict, todayStamp, vaultHealth } from "@/lib/links/health";
import { setFrontmatterProperty } from "@/lib/markdown/frontmatter";
import { readPref, writePref } from "@/lib/prefs";
import { displayName, dirname } from "@/lib/vault/paths";
import { useAiActions } from "../ai/useAsk";
import { useVault } from "../vault/useVault";
import { LinkMap } from "./LinkMap";

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
  /** Offers to create the missing note `target`, as linked from `from` (`hub`: a hub waiting to be written). */
  onCreate(target: string, from: string, hub?: boolean): void;
}) {
  const vault = useVault();
  const [tab, setTab] = useState<Tab>("broken");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Daily notes and templates are naturally unlinked; leave them out, and notes the user chose to ignore.
  const ignored = useMemo(() => healthIgnored(vault.settings), [vault.settings]);

  const aiAction = useAiActions();
  const health = useMemo(() => {
    const mtimes = new Map(vault.entries.map((e) => [e.path, e.mtime]));
    return vaultHealth(vault.indexed.links, { mtime: (p) => mtimes.get(p), ignore: ignored });
  }, [vault.indexed, vault.entries, ignored]);

  const graph = useMemo(() => {
    const g = vault.indexed.links.graph({ includeUnresolved: true });
    const nodes = g.nodes.filter((n) => n.unresolved || !ignored(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [vault.indexed, ignored]);
  const hubSet = useMemo(() => new Set(health.hubs.map((h) => h.path)), [health]);
  const orphanSet = useMemo(() => new Set(health.orphans), [health]);
  const pinnedSet = useMemo(() => new Set(health.hubs.filter((h) => h.kind === "marked").map((h) => h.path)), [health]);
  const candidateSet = useMemo(() => new Set(health.hubCandidates.map((c) => c.target.toLowerCase())), [health]);

  const open = (p: string) => {
    onClose();
    void vault.open(p);
  };

  /* ---------- Quick fixes ---------- */

  // Suggested links: where an orphan is mentioned, and what a dead end mentions.
  const suggestions = useMemo(() => {
    const out = new Map<string, { source: string; target: string; from: number; text: string; context: string }>();
    if (tab === "orphans")
      for (const p of health.orphans.slice(0, 100)) {
        const m = vault.indexed.links.unlinkedMentions(p)[0];
        if (m) out.set(p, { ...m, target: p });
      }
    if (tab === "deadEnds")
      for (const p of health.deadEnds.slice(0, 100)) {
        const m = vault.indexed.links.mentionsIn(p, 1)[0];
        if (m) out.set(p, m);
      }
    return out;
  }, [tab, health, vault.indexed]);

  // Orphans with no mention to link: the pinned hub each most likely belongs in.
  const hubFor = useMemo(() => {
    const out = new Map<string, { hub: string; reasons: string[] }>();
    if (tab !== "orphans") return out;
    const hubs = pinnedHubs(vault.indexed.links);
    if (hubs.length === 0) return out;
    for (const p of health.orphans.slice(0, 100)) {
      if (suggestions.has(p)) continue;
      const s = hubsFor(vault.indexed.links, p, hubs).suggestions[0];
      if (s) out.set(p, s);
    }
    return out;
  }, [tab, health, suggestions, vault.indexed]);

  /** Lists a note in a hub (in its Notes section, or at the end). */
  const addToHubNote = async (note: string, hub: string) => {
    const content = vault.textOf(hub);
    if (content === undefined) return;
    const target = vault.links.linkText(note);
    await vault.writeNote(hub, addToHub(content, formatLink(vault.settings.linkFormat, hub, { path: note, target }, target)));
  };

  /** Turns the mention into a link (in the repository's link format). */
  const linkMention = async (m: { source: string; target: string; from: number; text: string }) => {
    const content = vault.links.content(m.source);
    if (content === undefined || content.slice(m.from, m.from + m.text.length) !== m.text) return;
    const target = vault.links.linkText(m.target);
    const link = formatLink(vault.settings.linkFormat, m.source, { path: m.target, target, alias: target === m.text ? undefined : m.text }, target);
    await vault.writeNote(m.source, content.slice(0, m.from) + link + content.slice(m.from + m.text.length));
  };

  /** Sets (true/false) or removes the note's `hub` property. */
  const markHub = async (path: string, value: boolean | undefined) => {
    const content = vault.links.content(path);
    if (content === undefined) return;
    await vault.writeNote(path, setFrontmatterProperty(content, "hub", value));
  };

  /** Records today as the note's `reviewed:` date. */
  const markReviewed = async (path: string) => {
    const content = vault.textOf(path);
    if (content === undefined) return;
    await vault.writeNote(path, setFrontmatterProperty(content, "reviewed", todayStamp()));
  };

  const ignore = (p: string) => void vault.updateSettings({ healthIgnore: [...vault.settings.healthIgnore, p] });
  const restoreIgnored = () => void vault.updateSettings({ healthIgnore: [] });

  // Issues fixed today: the count when first opened today, minus the count now.
  const issues = health.broken.length + health.orphans.length + health.deadEnds.length + health.stale.length;
  const [baseline] = useState(() => {
    const key = `health:${vault.vaultId}:today`;
    const today = new Date().toDateString();
    const saved = readPref<{ day: string; issues: number } | null>(key, null);
    if (saved?.day === today) return saved.issues;
    writePref(key, { day: today, issues });
    return issues;
  });
  const fixedToday = Math.max(0, baseline - issues);

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
      hint:
        "The notes that hold the repository together: ones many notes link to, index notes linking out to a topic, and notes pinned with hub: true (shown in the sidebar). Link new notes to their hub as you write.",
      tone: "good",
      detail: health.hubCandidates.length
        ? `${health.hubCandidates.length} waiting to be written`
        : health.hubs[0]
          ? `Top: ${displayName(health.hubs[0].path)}`
          : "None yet",
    },
    {
      id: "stale",
      label: "Stale hubs",
      count: health.stale.length,
      hint: "Notes three or more others rely on that haven't changed or been reviewed in six months. Still accurate? Mark it reviewed.",
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
                {fixedToday > 0 && (
                  <p className="health-fixed" role="status">
                    {fixedToday} {fixedToday === 1 ? "issue" : "issues"} fixed today
                  </p>
                )}
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

          <LinkMap
            graph={graph}
            hubs={hubSet}
            orphans={orphanSet}
            candidates={candidateSet}
            pinned={pinnedSet}
            onOpen={open}
            onCreate={(target, from, hub) => {
              onClose();
              onCreate(target, from, hub);
            }}
          />

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
          <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border px-6 py-2.5">
            <p className="min-w-0 flex-1 text-sm text-muted">{current.hint}</p>
            {aiAction && tab === "orphans" && health.orphans.length > 0 && (
              <button
                type="button"
                className="button-secondary shrink-0 px-2.5 py-1 text-xs"
                title="The AI looks for the hub or note each orphan belongs in, and proposes links for you to review"
                onClick={() => {
                  onClose();
                  aiAction({ kind: "fix-orphans", paths: health.orphans });
                }}
              >
                <Sparkles size={12} aria-hidden /> Find homes with AI
              </button>
            )}
            {aiAction && tab === "stale" && health.stale.length > 0 && (
              <button
                type="button"
                className="button-secondary shrink-0 px-2.5 py-1 text-xs"
                title="The AI checks each hub against newer notes and proposes updates, then marking it reviewed"
                onClick={() => {
                  onClose();
                  aiAction({ kind: "review-stale", paths: health.stale.map((h) => h.path) });
                }}
              >
                <Sparkles size={12} aria-hidden /> Review with AI
              </button>
            )}
          </div>
          <ul role="tabpanel" aria-label={current.label} className="divide-y divide-border px-4 py-1">
          {current.count === 0 && <li className="px-2 py-6 text-center text-sm text-muted">Nothing here.</li>}
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
            health[tab].map((p) => {
              const m = suggestions.get(p);
              const other = m ? (tab === "orphans" ? m.source : m.target) : null;
              const h = hubFor.get(p);
              return row(
                p,
                noteButton(p),
                m && other ? (
                  <>
                    {tab === "orphans" ? "Mentioned in " : "Mentions "}
                    <span className="text-foreground/80">{displayName(other)}</span>: “{m.context.trim()}”
                  </>
                ) : h ? (
                  <>
                    Could go in the hub <span className="text-foreground/80">{displayName(h.hub)}</span>: {h.reasons.join(" · ")}
                  </>
                ) : (
                  dirname(p) || undefined
                ),
                <div className="flex shrink-0 gap-1.5">
                  {h && (
                    <button
                      type="button"
                      className="button-secondary px-2.5 py-1 text-xs"
                      aria-label={`Add ${displayName(p)} to ${displayName(h.hub)}`}
                      title={`List ${displayName(p)} in the hub ${displayName(h.hub)}`}
                      onClick={() => void addToHubNote(p, h.hub)}
                    >
                      Add to {displayName(h.hub)}
                    </button>
                  )}
                  {m && other && (
                    <button
                      type="button"
                      className="button-secondary px-2.5 py-1 text-xs"
                      aria-label={tab === "orphans" ? `Link ${displayName(p)} from ${displayName(other)}` : `Link ${displayName(p)} to ${displayName(other)}`}
                      onClick={() => void linkMention(m)}
                    >
                      {tab === "orphans" ? "Link from " : "Link to "}
                      {displayName(other)}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-secondary px-2.5 py-1 text-xs text-muted"
                    aria-label={`Ignore ${displayName(p)}`}
                    title="Leave this note out of the health checks"
                    onClick={() => ignore(p)}
                  >
                    Ignore
                  </button>
                </div>,
              );
            })}
          {tab === "hubs" &&
            health.hubCandidates.map((c) =>
              row(
                `?${c.target}`,
                <>
                  <span className="text-muted italic">{c.target}</span>
                  <span className="hub-badge hub-badge-waiting">waiting to be written</span>
                </>,
                `${c.sources.length} notes already link here`,
                <div className="flex shrink-0 gap-1.5">
                  {aiAction && (
                    <button
                      type="button"
                      className="button-secondary px-2.5 py-1 text-xs"
                      aria-label={`Write hub ${c.target} with AI`}
                      title="The AI reads the notes that link here and drafts the hub, for you to review"
                      onClick={() => {
                        onClose();
                        aiAction({ kind: "write-hub", target: c.target, sources: c.sources });
                      }}
                    >
                      <Sparkles size={12} aria-hidden /> Write with AI
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-secondary px-2.5 py-1 text-xs"
                    aria-label={`Create hub ${c.target}`}
                    onClick={() => {
                      onClose();
                      onCreate(c.target, c.sources[0], true);
                    }}
                  >
                    Create
                  </button>
                </div>,
              ),
            )}
          {tab === "hubs" &&
            health.hubs.map((h) =>
              row(
                h.path,
                <>
                  {noteButton(h.path)}
                  <span className={`hub-badge hub-badge-${h.kind}`}>{HUB_KIND[h.kind]}</span>
                </>,
                `${h.links} ${h.links === 1 ? "note links" : "notes link"} here · links to ${h.out}`,
                <div className="flex shrink-0 gap-1.5">
                  {h.kind !== "marked" && (
                    <button
                      type="button"
                      className="button-secondary px-2.5 py-1 text-xs"
                      aria-label={`Pin ${displayName(h.path)} to the sidebar`}
                      title="Add hub: true to the note, so it's listed under Hubs in the sidebar"
                      onClick={() => void markHub(h.path, true)}
                    >
                      Pin
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-secondary px-2.5 py-1 text-xs text-muted"
                    aria-label={h.kind === "marked" ? `Unpin ${displayName(h.path)}` : `${displayName(h.path)} is not a hub`}
                    title={h.kind === "marked" ? "Remove hub: true from the note" : "Add hub: false to the note, so it isn't counted"}
                    onClick={() => void markHub(h.path, h.kind === "marked" ? undefined : false)}
                  >
                    {h.kind === "marked" ? "Unpin" : "Not a hub"}
                  </button>
                </div>,
              ),
            )}
          {tab === "stale" &&
            health.stale.map((h) =>
              row(
                h.path,
                noteButton(h.path),
                `${h.links} notes link here · last changed ${new Date(h.mtime).toLocaleDateString()}` +
                  (h.reviewed ? ` · reviewed ${new Date(h.reviewed).toLocaleDateString()}` : ""),
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    className="button-secondary px-2.5 py-1 text-xs"
                    aria-label={`Mark ${displayName(h.path)} reviewed`}
                    title="Still accurate? Record today as reviewed: in the note's properties"
                    onClick={() => void markReviewed(h.path)}
                  >
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    className="button-secondary px-2.5 py-1 text-xs text-muted"
                    aria-label={`Ignore ${displayName(h.path)}`}
                    title="Leave this note out of the health checks"
                    onClick={() => ignore(h.path)}
                  >
                    Ignore
                  </button>
                </div>,
              ),
            )}
          </ul>
          {vault.settings.healthIgnore.length > 0 && (
            <p className="px-6 pt-1 pb-4 text-xs text-muted">
              {vault.settings.healthIgnore.length} {vault.settings.healthIgnore.length === 1 ? "note is" : "notes are"} left out of
              these checks.{" "}
              <button type="button" className="underline hover:text-accent" onClick={restoreIgnored}>
                Check them again
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const HUB_KIND = { marked: "pinned", linked: "many links in", index: "index" } as const;

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
