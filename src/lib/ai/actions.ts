import type { LinkIndex } from "../links/link-index";
import { displayName } from "../vault/paths";

/**
 * The agent's ready-made jobs, run from where they belong (the palette,
 * Connections, Properties, Repository health, hubs, the property table,
 * Today). Each becomes a chat question: a short label the user sees and the
 * full instructions the model gets. Changes come back as proposals.
 */
export type AgentAction =
  | { kind: "summarise"; path: string }
  | { kind: "suggest-links"; path: string }
  | { kind: "suggest-properties"; path: string }
  | { kind: "write-hub"; target: string; sources: string[] }
  | { kind: "fix-orphans"; paths: string[] }
  | { kind: "review-stale"; paths: string[] }
  | { kind: "fill-property"; key: string; paths: string[] }
  | { kind: "daily-review"; days?: number };

export interface ActionContext {
  links: LinkIndex;
  /** Every note with when it last changed. */
  notes(): Array<{ path: string; mtime: number }>;
  today: string;
  now?: number;
}

export interface ActionPrompt {
  /** What the chat shows as the question. */
  label: string;
  /** What the model is asked. */
  prompt: string;
  /** A note whose text goes with the question. */
  note?: string;
}

const MAX_LIST = 25;
const list = (paths: string[]) =>
  paths
    .slice(0, MAX_LIST)
    .map((p) => `- ${p}`)
    .join("\n") + (paths.length > MAX_LIST ? `\n- …and ${paths.length - MAX_LIST} more (leave those for later)` : "");
const NO_WRITE = "If you can't propose changes, list what you would change instead.";

export function actionPrompt(a: AgentAction, ctx: ActionContext): ActionPrompt {
  switch (a.kind) {
    case "summarise":
      return {
        label: `Summarise ${displayName(a.path)}`,
        note: a.path,
        prompt: [
          `Summarise the note "${a.path}" in a few bullet points: its main points, decisions and open questions.`,
          `Then propose setting its \`summary\` property to one sentence (set_property). ${NO_WRITE}`,
        ].join("\n"),
      };
    case "suggest-links":
      return {
        label: `Suggest links for ${displayName(a.path)}`,
        note: a.path,
        prompt: [
          `Find notes that "${a.path}" should link to, and notes that should link to it.`,
          "Use get_links (unlinked mentions and related notes) and search_notes for its main topics, and read a note when unsure.",
          `Propose add_link for each good connection (at most 8), and say in a line why each fits. ${NO_WRITE}`,
        ].join("\n"),
      };
    case "suggest-properties":
      return {
        label: `Suggest tags and properties for ${displayName(a.path)}`,
        note: a.path,
        prompt: [
          `Suggest tags and properties for "${a.path}" in this repository's own vocabulary.`,
          "First list what's in use: find_by_tag and find_by_property with no arguments. Reuse existing tag and property names and values; only invent one when nothing fits.",
          `Propose set_property for each (tags as a list, including the note's current tags). ${NO_WRITE}`,
        ].join("\n"),
      };
    case "write-hub":
      return {
        label: `Write the hub ${a.target}`,
        prompt: [
          `${a.sources.length} notes link to "${a.target}", which doesn't exist yet:`,
          list(a.sources),
          "Read them (sections are enough), then propose create_note for it as a map of content:",
          "a short introduction, then headings that group links to those notes with a few words on each, and the property hub: true.",
          `Use the exact name "${a.target}" so the existing links find it. ${NO_WRITE}`,
        ].join("\n"),
      };
    case "fix-orphans":
      return {
        label: `Find homes for ${a.paths.length} orphan ${a.paths.length === 1 ? "note" : "notes"}`,
        prompt: [
          "Nothing links to these notes:",
          list(a.paths),
          "For each, find the hub or note it belongs in: list_hubs, hub_for, search_notes on its topic, reading it if needed.",
          `Propose add_link from that hub or note to the orphan. Skip any you're unsure of, and say which. ${NO_WRITE}`,
        ].join("\n"),
      };
    case "review-stale": {
      const when = (p: string) => {
        const m = ctx.notes().find((n) => n.path === p)?.mtime;
        return m ? ` (last changed ${new Date(m).toISOString().slice(0, 10)})` : "";
      };
      return {
        label: `Review ${a.paths.length} stale ${a.paths.length === 1 ? "hub" : "hubs"}`,
        prompt: [
          "These hubs haven't changed in a long time, though many notes rely on them:",
          a.paths.slice(0, MAX_LIST).map((p) => `- ${p}${when(p)}`).join("\n"),
          "For each, read it, then look for newer notes on its topic that it doesn't list yet (search_notes, get_links).",
          `Propose add_link or append_to_note for what's missing, and set_property reviewed: ${ctx.today} for each hub you checked. ${NO_WRITE}`,
        ].join("\n"),
      };
    }
    case "fill-property":
      return {
        label: `Fill in ${a.key} for ${a.paths.length} ${a.paths.length === 1 ? "file" : "files"}`,
        prompt: [
          `These files have no \`${a.key}\` property yet:`,
          list(a.paths),
          `First see the values already in use: find_by_property with key "${a.key}". Then read each file and propose set_property ${a.key} with a fitting value, reusing existing values where they fit.`,
          `Skip a file when its text doesn't say. ${NO_WRITE}`,
        ].join("\n"),
      };
    case "daily-review": {
      const days = a.days ?? 7;
      const since = (ctx.now ?? Date.now()) - days * 86_400_000;
      const recent = ctx
        .notes()
        .filter((n) => n.mtime >= since)
        .sort((x, y) => y.mtime - x.mtime);
      return {
        label: days === 7 ? "What did I work on this week?" : `What did I work on in the last ${days} days?`,
        prompt: recent.length
          ? [
              `Notes changed in the last ${days} days, newest first:`,
              recent.slice(0, 40).map((n) => `- ${n.path} (${new Date(n.mtime).toISOString().slice(0, 10)})`).join("\n"),
              "Read the ones that matter, then summarise what I worked on: the main themes, decisions, open questions and loose ends, and what to do next.",
              "Link every note you mention.",
            ].join("\n")
          : `No notes changed in the last ${days} days. Say so, and suggest a note worth coming back to (repository_health, list_hubs).`,
      };
    }
  }
}
