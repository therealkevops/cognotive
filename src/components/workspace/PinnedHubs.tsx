"use client";

import { ChevronRight, FilePlus2, PinOff, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { hubCandidates, hubProperty } from "@/lib/links/health";
import { setFrontmatterProperty } from "@/lib/markdown/frontmatter";
import { readPref, writePref } from "@/lib/prefs";
import { isNote, noteTitle } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

/**
 * Notes pinned as hubs (`hub: true`), above the file tree: the repository's
 * entry points, then missing notes so many link to that they're hubs waiting
 * to be written. Hidden while there are neither.
 */
export function PinnedHubs({ onCreate }: { onCreate(target: string, from: string): void }) {
  const vault = useVault();
  const prefKey = `vault:${vault.vaultId}:hubs-open`;
  const [open, setOpen] = useState(() => readPref<boolean>(prefKey, true));

  const hubs = useMemo(() => {
    const inbound = vault.links.inboundCounts();
    return vault.links
      .paths()
      .filter((p) => isNote(p) && hubProperty(vault.links.get(p)?.properties) === true)
      .map((path) => ({ path, title: noteTitle(path), links: inbound.get(path) ?? 0 }))
      .sort((a, b) => a.title.localeCompare(b.title));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [vault.links, vault.indexVersion]);

  const candidates = useMemo(
    () => hubCandidates(vault.links),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion],
  );

  if (hubs.length === 0 && candidates.length === 0) return null;

  const toggle = () => {
    setOpen(!open);
    writePref(prefKey, !open);
  };
  const unpin = async (path: string) => {
    const content = path === vault.active?.path ? vault.activeText : vault.links.content(path);
    if (content !== undefined) await vault.writeNote(path, setFrontmatterProperty(content, "hub", undefined));
  };

  return (
    <section aria-label="Hubs" className="mb-3 border-b border-border pb-2">
      <button
        type="button"
        aria-expanded={open}
        className="mb-1 flex w-full items-center gap-1 px-2 text-xs font-medium text-muted hover:text-foreground"
        onClick={toggle}
      >
        <ChevronRight size={12} aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`} />
        Hubs
        <span className="ml-auto font-normal">{hubs.length + candidates.length}</span>
      </button>
      {open && (
        <ul className="max-h-48 overflow-y-auto">
          {hubs.map((h) => {
            const active = vault.active?.path === h.path;
            return (
              <li key={h.path} className={`nav-item group py-1 pr-1 ${active ? "bg-foreground/[0.07]" : ""}`}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={h.links ? `${h.path} · ${h.links} ${h.links === 1 ? "note links" : "notes link"} here` : h.path}
                  aria-label={h.title}
                  aria-current={active ? "page" : undefined}
                  onClick={() => void vault.open(h.path)}
                >
                  <Waypoints size={14} aria-hidden className="shrink-0 text-[#3f9d63]" />
                  <span className="truncate">{h.title}</span>
                  {h.links > 0 && <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">{h.links}</span>}
                </button>
                <button
                  type="button"
                  className="icon-button invisible h-6 w-6 shrink-0 group-hover:visible focus-visible:visible"
                  aria-label={`Unpin ${h.title}`}
                  title="Unpin (removes hub: true from the note)"
                  onClick={() => void unpin(h.path)}
                >
                  <PinOff size={13} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && candidates.length > 0 && (
        <>
          <h3 className="mt-1.5 mb-0.5 px-2 text-[11px] font-medium text-muted">To write</h3>
          <ul aria-label="Hubs to write" className="max-h-32 overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.target.toLowerCase()}>
                <button
                  type="button"
                  className="nav-item group w-full py-1 text-left"
                  aria-label={`Create hub ${c.target}`}
                  title={`${c.sources.length} notes link to ${c.target}, which doesn't exist yet. Create it as a hub.`}
                  onClick={() => onCreate(c.target, c.sources[0])}
                >
                  <FilePlus2 size={14} aria-hidden className="shrink-0 text-[#d9772b]" />
                  <span className="truncate italic text-foreground/75">{c.target}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">{c.sources.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
