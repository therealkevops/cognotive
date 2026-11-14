"use client";

import { useMemo, useState } from "react";
import { formatLink } from "@/lib/links/format";
import type { Backlink, Mention } from "@/lib/links/link-index";
import { noteTitle } from "@/lib/vault/paths";
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
        className="mb-2 flex w-full items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase"
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
export function LinksPanel({
  onOpenLink,
  onCreate,
}: {
  onOpenLink(target: string, heading?: string): void;
  /** Offers to create the missing note `target`, as linked from `from`. */
  onCreate(target: string, from: string): void;
}) {
  const vault = useVault();
  const path = vault.active?.path;
  // Every link in the vault to a note that doesn't exist yet, grouped case-insensitively.
  const unresolved = useMemo(() => {
    const groups = new Map<string, { target: string; sources: string[] }>();
    for (const [target, sources] of vault.links.unresolved()) {
      const key = target.toLowerCase();
      const g = groups.get(key) ?? { target, sources: [] };
      for (const s of sources) if (!g.sources.includes(s)) g.sources.push(s);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.sources.length - a.sources.length || a.target.localeCompare(b.target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.links, vault.indexVersion]);

  const { backlinks, mentions, outgoing } = useMemo(() => {
    if (!path) return { backlinks: [] as Backlink[], mentions: [] as Mention[], outgoing: [] };
    return {
      backlinks: vault.links.backlinks(path),
      mentions: vault.links.unlinkedMentions(path),
      outgoing: vault.links.outgoing(path),
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
                  {noteTitle(source)}
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

      <Section title="Unresolved links" count={unresolved.length} defaultOpen={false}>
        {unresolved.length === 0 ? (
          <p className="text-sm text-muted">Every link in the vault points to a note that exists.</p>
        ) : (
          <ul className="space-y-2">
            {unresolved.map((u) => (
              <li key={u.target} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-muted italic">{u.target}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-border px-1.5 text-xs hover:border-accent hover:text-accent"
                    aria-label={`Create ${u.target}`}
                    onClick={() => onCreate(u.target, u.sources[0])}
                  >
                    Create
                  </button>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Linked from{" "}
                  {u.sources.slice(0, 3).map((src, i) => (
                    <span key={src}>
                      {i > 0 && ", "}
                      <button type="button" className="hover:text-accent hover:underline" onClick={() => void vault.open(src)}>
                        {noteTitle(src)}
                      </button>
                    </span>
                  ))}
                  {u.sources.length > 3 && ` and ${u.sources.length - 3} more`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
