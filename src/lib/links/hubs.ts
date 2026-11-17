import { isNote, noteTitle } from "../vault/paths";
import { hubProperty } from "./health";
import type { LinkIndex } from "./link-index";

/** Notes pinned as hubs (`hub: true`). */
export function pinnedHubs(index: LinkIndex): string[] {
  return index
    .paths()
    .filter((p) => isNote(p) && hubProperty(index.get(p)?.properties) === true)
    .sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)));
}

export interface HubLink {
  hub: string;
  /** "in": the hub links to this note; "out": this note links to the hub. */
  direction: "in" | "out" | "both";
}

export interface HubSuggestion {
  hub: string;
  /** Why it might belong there, e.g. "mentions Cooking", "tagged #food". */
  reasons: string[];
  score: number;
}

/**
 * The pinned hubs a note is connected to, and (when it isn't connected to
 * any) the pinned hubs it most likely belongs in: ones it mentions by name,
 * shares tags with, or shares links with.
 */
export function hubsFor(index: LinkIndex, path: string, hubs = pinnedHubs(index)): { connected: HubLink[]; suggestions: HubSuggestion[] } {
  const out = new Set(index.outgoing(path).flatMap((o) => (o.resolved ? [o.resolved] : [])));
  const connected: HubLink[] = [];
  const others: string[] = [];
  for (const hub of hubs) {
    if (hub === path) continue;
    const hubLinksHere = index.outgoing(hub).some((o) => o.resolved === path);
    const linksToHub = out.has(hub);
    if (hubLinksHere || linksToHub) connected.push({ hub, direction: hubLinksHere && linksToHub ? "both" : hubLinksHere ? "in" : "out" });
    else others.push(hub);
  }
  if (connected.length > 0 || others.length === 0) return { connected, suggestions: [] };

  const mentioned = new Set(index.mentionsIn(path, 50).map((m) => m.target));
  const tags = new Set(index.get(path)?.tags ?? []);
  const suggestions: HubSuggestion[] = [];
  for (const hub of others) {
    const reasons: string[] = [];
    let score = 0;
    if (mentioned.has(hub)) {
      reasons.push(`mentions ${noteTitle(hub)}`);
      score += 3;
    }
    const sharedTags = (index.get(hub)?.tags ?? []).filter((t) => tags.has(t));
    if (sharedTags.length) {
      reasons.push(sharedTags.map((t) => `#${t}`).join(" "));
      score += sharedTags.length;
    }
    // Notes the hub gathers that this note also links to.
    const shared = index.outgoing(hub).filter((o) => o.resolved && out.has(o.resolved)).length;
    if (shared) {
      reasons.push(`${shared} of its notes linked here`);
      score += Math.min(3, shared);
    }
    if (score > 0) suggestions.push({ hub, reasons, score });
  }
  suggestions.sort((a, b) => b.score - a.score || noteTitle(a.hub).localeCompare(noteTitle(b.hub)));
  return { connected, suggestions: suggestions.slice(0, 3) };
}

/**
 * Adds `- <link>` to a hub note: at the end of its "Notes" section if it has
 * one (filling an empty "- " bullet there), otherwise at the end of the note.
 */
export function addToHub(content: string, link: string): string {
  const item = `- ${link}`;
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s+Notes\s*$/i.test(l));
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
    const empty = lines.slice(start + 1, end).findIndex((l) => /^\s*[-*]\s*$/.test(l));
    if (empty !== -1) {
      lines[start + 1 + empty] = item;
      return lines.join("\n");
    }
    // After the section's last non-blank line.
    let at = end;
    while (at > start + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, item);
    return lines.join("\n");
  }
  const body = content.replace(/\s+$/, "");
  const lastIsItem = /(^|\n)\s*[-*] [^\n]*$/.test(body);
  return `${body}${body ? (lastIsItem ? "\n" : "\n\n") : ""}${item}\n`;
}
