"use client";

import { LayoutDashboard } from "lucide-react";
import { useMemo, useState } from "react";
import { formatLink } from "@/lib/links/format";
import type { Backlink, CanvasRelation, Mention } from "@/lib/links/link-index";
import { canvasName, displayName, noteTitle } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

function group<T extends { source: string }>(items: T[]): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(i.source, [...(m.get(i.source) ?? []), i]);
  return [...m];
}

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  // Follows `defaultOpen` (which can change as the index updates) until the user toggles it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? defaultOpen;
  return (
    <section aria-label={title} className="mb-5">
      <button
        type="button"
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between text-xs font-medium text-muted"
        onClick={() => setToggled(!open)}
      >
        <span>{title}</span>
        <span className="rounded bg-foreground/5 px-1.5 font-normal normal-case">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

/** Backlinks, unlinked mentions and outgoing links of the open note. */
/**
 * Everything connected to the open note, grouped by how: typed relations from
 * canvases, links in and out, notes that share links with it, notes with the
 * same tags, and unlinked mentions. "Map as canvas" lays it all out on a board.
 */
export function LinksPanel({
  onOpenLink,
  onMapCanvas,
}: {
  onOpenLink(target: string, heading?: string): void;
  /** Makes a canvas of this note and its neighbours. */
  onMapCanvas?(): void;
}) {
  const vault = useVault();
  const path = vault.active?.path;

  const { backlinks, mentions, outgoing, relations, related, sameTags } = useMemo(() => {
    if (!path)
      return {
        backlinks: [] as Backlink[],
        mentions: [] as Mention[],
        outgoing: [],
        relations: [] as CanvasRelation[],
        related: [] as Array<{ path: string; score: number; via: string[] }>,
        sameTags: [] as Array<{ path: string; tags: string[] }>,
      };
    const linked = new Set([
      ...vault.links.backlinks(path).map((b) => b.source),
      ...vault.links.outgoing(path).flatMap((o) => (o.resolved ? [o.resolved] : [])),
    ]);
    // Notes with tags in common (and not already linked), most shared tags first.
    const byTag = new Map<string, string[]>();
    for (const tag of vault.links.get(path)?.tags ?? []) {
      for (const p of vault.links.withTag(tag)) {
        if (p === path || linked.has(p)) continue;
        byTag.set(p, [...(byTag.get(p) ?? []), tag]);
      }
    }
    return {
      backlinks: vault.links.backlinks(path),
      mentions: vault.links.unlinkedMentions(path),
      outgoing: vault.links.outgoing(path),
      relations: vault.links.canvasRelations(path),
      related: vault.links.related(path),
      sameTags: [...byTag]
        .map(([p, tags]) => ({ path: p, tags }))
        .sort((a, b) => b.tags.length - a.tags.length || a.path.localeCompare(b.path))
        .slice(0, 8),
    };
    // indexVersion signals index changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, vault.links, vault.indexVersion]);

  if (!path) return null;

  const linkMention = async (m: Mention) => {
    const content = vault.links.content(m.source);
    if (content === undefined || content.slice(m.from, m.from + m.text.length) !== m.text) return;
    const target = vault.links.linkText(path);
    const link = formatLink(vault.settings.linkFormat, m.source, { path, target, alias: target === m.text ? undefined : m.text }, target);
    await vault.writeNote(m.source, content.slice(0, m.from) + link + content.slice(m.from + m.text.length));
  };

  const uniqueOut = new Map<string, { label: string; resolved: string | null }>();
  for (const o of outgoing) {
    if (!o.link.target) continue;
    const key = o.resolved ?? `?${o.link.target.toLowerCase()}`;
    if (!uniqueOut.has(key)) uniqueOut.set(key, { label: o.resolved ? noteTitle(o.resolved) : o.link.target, resolved: o.resolved });
  }

  return (
    <div>
      {onMapCanvas && (
        <button
          type="button"
          className="button-secondary mb-4 w-full"
          onClick={onMapCanvas}
          title="Make a canvas with this note and everything connected to it"
        >
          <LayoutDashboard size={15} aria-hidden />
          Map as canvas
        </button>
      )}
      <Section title="Backlinks" count={backlinks.length}>
        {backlinks.length === 0 ? (
          <p className="text-sm text-muted">No notes link here yet.</p>
        ) : (
          <ul className="space-y-2">
            {group(backlinks).map(([source, items]) => (
              <li key={source}>
                <button
                  type="button"
                  className="text-left text-sm font-medium hover:text-accent"
                  onClick={() => void vault.open(source)}
                >
                  {displayName(source)}
                </button>
                <ul>
                  {items.map((b, i) => (
                    <li key={i} className="mt-0.5 line-clamp-2 text-xs text-muted">
                      {b.context}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {relations.length > 0 && (
        <Section title="Canvas connections" count={relations.length}>
          <ul className="space-y-1.5">
            {relations.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="text-muted">{r.direction === "out" ? `${r.label} →` : `← ${r.label}`}</span>{" "}
                <button
                  type="button"
                  className={`hover:underline ${r.resolved ? "text-accent" : "text-muted italic"}`}
                  onClick={() => (r.resolved ? void vault.open(r.other) : onOpenLink(r.other))}
                >
                  {r.resolved ? noteTitle(r.other) : r.other}
                </button>
                <button
                  type="button"
                  className="ml-1.5 text-xs text-muted hover:text-accent"
                  title="Open the canvas"
                  onClick={() => void vault.open(r.canvas)}
                >
                  on {canvasName(r.canvas)}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Shares links with" count={related.length} defaultOpen={related.length > 0}>
        {related.length === 0 ? (
          <p className="text-sm text-muted">No other notes share links with this one yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {related.map((r) => (
              <li key={r.path} className="text-sm">
                <button type="button" className="text-left font-medium hover:text-accent" onClick={() => void vault.open(r.path)}>
                  {displayName(r.path)}
                </button>
                <p className="truncate text-xs text-muted">Both connect to {r.via.map(displayName).join(", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {sameTags.length > 0 && (
        <Section title="Same tags" count={sameTags.length}>
          <ul className="space-y-1.5">
            {sameTags.map((t) => (
              <li key={t.path} className="text-sm">
                <button type="button" className="text-left font-medium hover:text-accent" onClick={() => void vault.open(t.path)}>
                  {displayName(t.path)}
                </button>
                <p className="truncate text-xs text-muted">{t.tags.map((x) => `#${x}`).join(" ")}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Unlinked mentions" count={mentions.length} defaultOpen={mentions.length > 0}>
        {mentions.length === 0 ? (
          <p className="text-sm text-muted">No other note mentions this one by name.</p>
        ) : (
          <ul className="space-y-2">
            {mentions.map((m) => (
              <li key={`${m.source}:${m.from}`} className="text-sm">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-medium hover:text-accent"
                    onClick={() => void vault.open(m.source)}
                  >
                    {noteTitle(m.source)}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-border px-1.5 text-xs hover:border-accent hover:text-accent"
                    aria-label={`Link the mention in ${noteTitle(m.source)}`}
                    onClick={() => void linkMention(m)}
                  >
                    Link
                  </button>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{m.context}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Outgoing links" count={uniqueOut.size}>
        {uniqueOut.size === 0 ? (
          <p className="text-sm text-muted">This note doesn&apos;t link anywhere.</p>
        ) : (
          <ul className="space-y-0.5">
            {[...uniqueOut.values()].map((o) => (
              <li key={o.resolved ?? o.label}>
                <button
                  type="button"
                  className={`text-left text-sm hover:underline ${o.resolved ? "text-accent" : "text-muted italic"}`}
                  title={o.resolved ? o.resolved : "Not created yet. Click to create it."}
                  onClick={() => (o.resolved ? void vault.open(o.resolved) : onOpenLink(o.label))}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

    </div>
  );
}
