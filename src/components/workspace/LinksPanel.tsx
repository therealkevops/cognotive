"use client";

import { ChevronRight, LayoutDashboard, Sparkles, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { formatLink } from "@/lib/links/format";
import { hubProperty } from "@/lib/links/health";
import { addToHub, hubsFor, pinnedHubs } from "@/lib/links/hubs";
import type { Backlink, CanvasRelation, Mention } from "@/lib/links/link-index";
import { markWords, snippet } from "@/lib/links/snippet";
import { canvasName, displayName, isNote, noteTitle } from "@/lib/vault/paths";
import { useAiActions } from "../ai/useAsk";
import { useSemantic } from "../semantic/useSemantic";
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
    <section aria-label={title} className="mb-4">
      <button
        type="button"
        aria-expanded={open}
        className={`-mx-1 mb-1 flex w-[calc(100%+0.5rem)] items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted hover:text-foreground ${
          count === 0 ? "opacity-70" : ""
        }`}
        onClick={() => setToggled(!open)}
      >
        <ChevronRight size={13} aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span>{title}</span>
        <span className="ml-auto rounded-md bg-foreground/[0.06] px-1.5 text-[11px] font-normal tabular-nums">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

/** A note in one of the lists: its name (opens it), a line or two about it, and maybe a button. */
function Item({
  title,
  onOpen,
  tooltip,
  detail,
  action,
  missing = false,
}: {
  title: React.ReactNode;
  onOpen(): void;
  tooltip?: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  /** A link to a note that doesn't exist yet. */
  missing?: boolean;
}) {
  return (
    <li className="-mx-2 rounded-lg px-2 py-1 hover:bg-foreground/[0.04]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`min-w-0 flex-1 truncate text-left text-sm ${missing ? "text-muted italic" : "font-medium"} hover:text-accent`}
          title={tooltip}
          onClick={onOpen}
        >
          {title}
        </button>
        {action}
      </div>
      {detail && <div className="mt-0.5 text-xs leading-snug text-muted">{detail}</div>}
    </li>
  );
}

/** A line from a note, as words: links stand out, and a mention's words are highlighted. */
function Snippet({ line, mark, quote = false }: { line: string; mark?: string; quote?: boolean }) {
  const parts = mark ? markWords(snippet(line), mark) : snippet(line);
  if (!parts.length) return null;
  return (
    <p className={`line-clamp-2 break-words ${quote ? "border-l-2 border-border pl-2" : ""}`}>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-accent/15 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : p.link ? (
          <span key={i} className="text-foreground/80">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

const MAX_SNIPPETS = 3;

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
  const aiAction = useAiActions();
  const semantic = useSemantic();
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
      ...vault.indexed.links.backlinks(path).map((b) => b.source),
      ...vault.indexed.links.outgoing(path).flatMap((o) => (o.resolved ? [o.resolved] : [])),
    ]);
    // Notes with tags in common (and not already linked), most shared tags first.
    const byTag = new Map<string, string[]>();
    for (const tag of vault.indexed.links.get(path)?.tags ?? []) {
      for (const p of vault.indexed.links.withTag(tag)) {
        if (p === path || linked.has(p)) continue;
        byTag.set(p, [...(byTag.get(p) ?? []), tag]);
      }
    }
    return {
      backlinks: vault.indexed.links.backlinks(path),
      mentions: vault.indexed.links.unlinkedMentions(path),
      outgoing: vault.indexed.links.outgoing(path),
      relations: vault.indexed.links.canvasRelations(path),
      related: vault.indexed.links.related(path),
      sameTags: [...byTag]
        .map(([p, tags]) => ({ path: p, tags }))
        .sort((a, b) => b.tags.length - a.tags.length || a.path.localeCompare(b.path))
        .slice(0, 8),
    };
  }, [path, vault.indexed]);

  const hubs = useMemo(() => {
    const all = pinnedHubs(vault.indexed.links);
    if (!path || all.length === 0) return null;
    return { ...hubsFor(vault.indexed.links, path, all), isHub: hubProperty(vault.indexed.links.get(path)?.properties) === true };
  }, [path, vault.indexed]);

  // Close in meaning but not linked either way: connections worth making.
  const similar = useMemo(() => {
    if (!path || !semantic.enabled) return [];
    const linked = new Set([path, ...backlinks.map((b) => b.source), ...outgoing.flatMap((o) => (o.resolved ? [o.resolved] : []))]);
    return semantic.similar(path, 12).filter((h) => !linked.has(h.path)).slice(0, 6);
    // semantic.version signals a finished indexing pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, semantic.enabled, semantic.version, backlinks, outgoing]);

  if (!path) return null;

  /** Lists this note in a hub (in its Notes section, or at the end). */
  const addTo = async (hub: string) => {
    const content = vault.textOf(hub);
    if (content === undefined) return;
    const target = vault.links.linkText(path);
    await vault.writeFile(hub, addToHub(content, formatLink(vault.settings.linkFormat, hub, { path, target }, target)));
  };

  const linkMention = async (m: Mention) => {
    const content = vault.links.content(m.source);
    if (content === undefined || content.slice(m.from, m.from + m.text.length) !== m.text) return;
    const target = vault.links.linkText(path);
    const link = formatLink(vault.settings.linkFormat, m.source, { path, target, alias: target === m.text ? undefined : m.text }, target);
    await vault.writeFile(m.source, content.slice(0, m.from) + link + content.slice(m.from + m.text.length));
  };

  const uniqueOut = new Map<string, { label: string; resolved: string | null }>();
  for (const o of outgoing) {
    if (!o.link.target) continue;
    const key = o.resolved ?? `?${o.link.target.toLowerCase()}`;
    if (!uniqueOut.has(key)) uniqueOut.set(key, { label: o.resolved ? noteTitle(o.resolved) : o.link.target, resolved: o.resolved });
  }

  const suggest = aiAction && isNote(path);
  return (
    <div>
      {(suggest || onMapCanvas) && (
        <div className={`mb-4 grid gap-2 ${suggest && onMapCanvas ? "grid-cols-2" : "grid-cols-1"}`}>
          {suggest && (
            <button
              type="button"
              className="button-secondary min-w-0 px-2 py-1.5 text-xs"
              aria-label="Suggest links with AI"
              title="The AI looks for notes this one should link to (and that should link here), and proposes links for you to review"
              onClick={() => aiAction({ kind: "suggest-links", path })}
            >
              <Sparkles size={14} aria-hidden className="shrink-0" />
              <span className="truncate">Suggest links</span>
            </button>
          )}
          {onMapCanvas && (
            <button
              type="button"
              className="button-secondary min-w-0 px-2 py-1.5 text-xs"
              onClick={onMapCanvas}
              title="Make a canvas with this note and everything connected to it"
            >
              <LayoutDashboard size={14} aria-hidden className="shrink-0" />
              <span className="truncate">Map as canvas</span>
            </button>
          )}
        </div>
      )}

      {hubs && (
        <Section title="In hubs" count={hubs.connected.length}>
          {hubs.isHub && <p className="mb-1.5 text-xs text-muted">This note is a pinned hub.</p>}
          {hubs.connected.length > 0 ? (
            <ul className="space-y-0.5">
              {hubs.connected.map((h) => (
                <Item
                  key={h.hub}
                  title={
                    <span className="inline-flex items-center gap-1.5">
                      <Waypoints size={13} aria-hidden className="shrink-0 text-[#3f9d63]" />
                      {noteTitle(h.hub)}
                    </span>
                  }
                  onOpen={() => void vault.open(h.hub)}
                  detail={h.direction === "in" ? "Lists this note" : h.direction === "out" ? "Linked from here" : "Linked both ways"}
                />
              ))}
            </ul>
          ) : (
            !hubs.isHub && (
              <>
                <p className="text-xs text-muted">Not in a hub yet.</p>
                {hubs.suggestions.length > 0 && (
                  <ul aria-label="Suggested hubs" className="mt-1.5 space-y-0.5">
                    {hubs.suggestions.map((s) => (
                      <Item
                        key={s.hub}
                        title={noteTitle(s.hub)}
                        onOpen={() => void vault.open(s.hub)}
                        detail={<p className="truncate">{s.reasons.join(" · ")}</p>}
                        action={
                          <button
                            type="button"
                            className="button-secondary shrink-0 px-2 py-0.5 text-xs"
                            aria-label={`Add to ${noteTitle(s.hub)}`}
                            title={`List this note in ${noteTitle(s.hub)}`}
                            onClick={() => void addTo(s.hub)}
                          >
                            Add
                          </button>
                        }
                      />
                    ))}
                  </ul>
                )}
              </>
            )
          )}
        </Section>
      )}

      <Section title="Backlinks" count={backlinks.length}>
        {backlinks.length === 0 ? (
          <p className="text-xs text-muted">No notes link here yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {group(backlinks).map(([source, items]) => (
              <Item
                key={source}
                title={displayName(source)}
                onOpen={() => void vault.open(source)}
                detail={
                  <div className="mt-1 space-y-1">
                    {items.slice(0, MAX_SNIPPETS).map((b, i) => (
                      <Snippet key={i} line={b.context} quote />
                    ))}
                    {items.length > MAX_SNIPPETS && <p className="pl-2.5">and {items.length - MAX_SNIPPETS} more</p>}
                  </div>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      {relations.length > 0 && (
        <Section title="Canvas connections" count={relations.length}>
          <ul className="space-y-0.5">
            {relations.map((r, i) => (
              <Item
                key={i}
                title={r.resolved ? noteTitle(r.other) : r.other}
                missing={!r.resolved}
                onOpen={() => (r.resolved ? void vault.open(r.other) : onOpenLink(r.other))}
                detail={
                  <>
                    {r.direction === "out" ? `${r.label} →` : `← ${r.label}`}
                    {" · "}
                    <button type="button" className="hover:text-accent" title="Open the canvas" onClick={() => void vault.open(r.canvas)}>
                      on {canvasName(r.canvas)}
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        </Section>
      )}

      {semantic.enabled && (
        <Section title="Similar in meaning" count={similar.length} defaultOpen={similar.length > 0}>
          {similar.length === 0 ? (
            <p className="text-xs text-muted">
              {semantic.status.state === "ready" ? "No unlinked notes are close in meaning." : "Indexing notes for search by meaning…"}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {similar.map((h) => (
                <Item
                  key={h.path}
                  title={displayName(h.path)}
                  onOpen={() => void vault.open(h.path)}
                  detail={
                    <p className="line-clamp-2" title={h.preview}>
                      {h.heading && h.heading !== displayName(h.path) ? `${h.heading}: ` : ""}
                      {snippet(h.preview).map((p) => p.text).join("")}
                    </p>
                  }
                />
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Shares links with" count={related.length} defaultOpen={related.length > 0}>
        {related.length === 0 ? (
          <p className="text-xs text-muted">No other notes share links with this one yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {related.map((r) => (
              <Item
                key={r.path}
                title={displayName(r.path)}
                onOpen={() => void vault.open(r.path)}
                detail={<p className="truncate">Both connect to {r.via.map(displayName).join(", ")}</p>}
              />
            ))}
          </ul>
        )}
      </Section>

      {sameTags.length > 0 && (
        <Section title="Same tags" count={sameTags.length}>
          <ul className="space-y-0.5">
            {sameTags.map((t) => (
              <Item
                key={t.path}
                title={displayName(t.path)}
                onOpen={() => void vault.open(t.path)}
                detail={<p className="truncate">{t.tags.map((x) => `#${x}`).join(" ")}</p>}
              />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Unlinked mentions" count={mentions.length} defaultOpen={mentions.length > 0}>
        {mentions.length === 0 ? (
          <p className="text-xs text-muted">No other note mentions this one by name.</p>
        ) : (
          <ul className="space-y-0.5">
            {mentions.map((m) => (
              <Item
                key={`${m.source}:${m.from}`}
                title={noteTitle(m.source)}
                onOpen={() => void vault.open(m.source)}
                detail={<Snippet line={m.context} mark={m.text} />}
                action={
                  <button
                    type="button"
                    className="button-secondary shrink-0 px-2 py-0.5 text-xs"
                    aria-label={`Link the mention in ${noteTitle(m.source)}`}
                    title={`Make “${m.text}” in ${noteTitle(m.source)} a link to this note`}
                    onClick={() => void linkMention(m)}
                  >
                    Link
                  </button>
                }
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Outgoing links" count={uniqueOut.size}>
        {uniqueOut.size === 0 ? (
          <p className="text-xs text-muted">This note doesn&apos;t link anywhere.</p>
        ) : (
          <ul className="space-y-0.5">
            {[...uniqueOut.values()].map((o) => (
              <Item
                key={o.resolved ?? o.label}
                title={o.label}
                missing={!o.resolved}
                tooltip={o.resolved ? o.resolved : "Not created yet. Click to create it."}
                onOpen={() => (o.resolved ? void vault.open(o.resolved) : onOpenLink(o.label))}
                detail={o.resolved ? undefined : "Not created yet"}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
