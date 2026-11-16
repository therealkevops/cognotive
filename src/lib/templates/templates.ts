/**
 * Note templates: ordinary notes in the templates folder, with fields filled in
 * when they're used.
 *
 * Fields
 *   {{title}}                 the new note's name
 *   {{date}} {{time}}         now; {{date:dddd D MMMM}} for a custom format
 *   {{folder}}                the folder the note goes in
 *   {{input:Client}}          asks for a value when the template is used
 *   {{input:Status|Draft}}    …with a default
 *   {{cursor}}                where typing starts afterwards
 *
 * Settings, in the template's properties (removed from the note):
 *   template-folder: Meetings                    where new notes go
 *   template-name: "{{date}} {{input:Topic}}"    how new notes are named
 * Other properties (tags, status…) are copied to the note.
 */
import { splitFrontmatter } from "../markdown/frontmatter";
import { formatDate } from "../vault/settings";

export interface TemplateInput {
  label: string;
  /** Pre-filled value, from {{input:Label|default}}. */
  default: string;
}

export interface TemplateContext {
  title: string;
  now: Date;
  folder: string;
  /** Values typed for {{input:…}} fields, by label. */
  inputs: Record<string, string>;
}

const FIELD = /\{\{\s*(title|date|time|folder|cursor|input)(?::([^}]*))?\s*\}\}/g;
const CURSOR = "\u0000cursor\u0000";
const TEMPLATE_KEYS = new Set(["template-folder", "template-name"]);

/** Every {{input:…}} field, once per label, in order of first use. */
export function templateInputs(text: string): TemplateInput[] {
  const out = new Map<string, TemplateInput>();
  for (const m of text.matchAll(FIELD)) {
    if (m[1] !== "input" || !m[2]) continue;
    const [label, ...rest] = m[2].split("|");
    const key = label.trim();
    if (key && !out.has(key)) out.set(key, { label: key, default: rest.join("|").trim() });
  }
  return [...out.values()];
}

function fill(text: string, ctx: TemplateContext): string {
  return text.replace(FIELD, (_, name: string, arg?: string) => {
    switch (name) {
      case "title":
        return ctx.title;
      case "date":
        return formatDate(ctx.now, arg?.trim() || "YYYY-MM-DD");
      case "time":
        return formatDate(ctx.now, arg?.trim() || "HH:mm");
      case "folder":
        return ctx.folder;
      case "cursor":
        return CURSOR;
      default: {
        const [label, ...rest] = (arg ?? "").split("|");
        return ctx.inputs[label.trim()] ?? rest.join("|").trim();
      }
    }
  });
}

interface Property {
  key: string;
  /** The key's line and any indented or list lines under it. */
  lines: string[];
}

/** Top-level properties of a frontmatter block, keeping their lines as written. */
function properties(frontmatter: string): Property[] {
  const inner = frontmatter.replace(/^---\r?\n/, "").replace(/\r?\n---[ \t]*(\r?\n)?$/, "");
  const props: Property[] = [];
  for (const line of inner.split(/\r?\n/)) {
    const key = /^([^\s:#-][^:]*):/.exec(line)?.[1]?.trim();
    if (key !== undefined) props.push({ key, lines: [line] });
    else if (props.length && line.trim()) props[props.length - 1].lines.push(line);
  }
  return props;
}

const block = (props: Property[]) =>
  props.length ? `---\n${props.flatMap((p) => p.lines).join("\n")}\n---\n` : "";

/** The template's own settings: where new notes go and how they're named (unfilled). */
export function templateSettings(text: string): { folder: string | null; name: string | null } {
  const props = properties(splitFrontmatter(text).frontmatter);
  const value = (key: string) => {
    const p = props.find((x) => x.key === key);
    const v = p?.lines[0].slice(p.lines[0].indexOf(":") + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    return v ? v : null;
  };
  return { folder: value("template-folder"), name: value("template-name") };
}

/** Fills a field-bearing string such as a name pattern; strips characters files can't have. */
export function fillName(pattern: string, ctx: Omit<TemplateContext, "title">): string {
  return fill(pattern, { ...ctx, title: "" })
    .replaceAll(CURSOR, "")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Rendered {
  /** Properties to add, as a frontmatter block ("" for none). */
  frontmatter: string;
  body: string;
  /** Where {{cursor}} was, as an offset into `body`; null if absent. */
  cursor: number | null;
}

/** Fills a template. Its own settings are dropped from the properties. */
export function renderTemplate(text: string, ctx: TemplateContext): Rendered {
  const filled = fill(text, ctx);
  const { frontmatter, body: rawBody } = splitFrontmatter(filled);
  const props = properties(frontmatter).filter((p) => !TEMPLATE_KEYS.has(p.key));
  const at = rawBody.indexOf(CURSOR);
  const body = rawBody.replaceAll(CURSOR, "");
  return { frontmatter: block(props).replaceAll(CURSOR, ""), body, cursor: at === -1 ? null : at };
}

/** A whole new note from a rendered template, and where the cursor goes. */
export function noteFromTemplate(r: Rendered): { content: string; cursor: number } {
  const content = r.frontmatter + r.body;
  return { content, cursor: r.frontmatter.length + (r.cursor ?? r.body.length) };
}

/**
 * Inserts a rendered template into a note at `pos`. Its properties go into the
 * note's frontmatter (only keys the note doesn't already have), and the cursor
 * lands on {{cursor}} or after the inserted text.
 */
export function insertIntoNote(note: string, pos: number, r: Rendered): { text: string; cursor: number } {
  const { frontmatter, body } = splitFrontmatter(note);
  const add = properties(r.frontmatter);
  let head = frontmatter;
  if (add.length) {
    const existing = properties(frontmatter);
    const have = new Set(existing.map((p) => p.key));
    head = block([...existing, ...add.filter((p) => !have.has(p.key))]);
  }
  const at = Math.max(frontmatter.length, pos) - frontmatter.length; // never inside the frontmatter
  const text = head + body.slice(0, at) + r.body + body.slice(at);
  return { text, cursor: head.length + at + (r.cursor ?? r.body.length) };
}

/** Templates added to a new repository, if chosen: path within the templates folder → content. */
export const STARTER_TEMPLATES: Record<string, string> = {
  "Meeting.md": `---
template-folder: Meetings
template-name: "{{date}} {{input:Meeting about}}"
tags: [meeting]
---
# {{input:Meeting about}}

**Date:** {{date:dddd D MMMM YYYY}}, {{time}}
**With:** {{input:Who's there}}

## Agenda

- {{cursor}}

## Notes

## Decisions

## Actions

- [ ] 
`,
  "Project.md": `---
template-folder: Projects
tags: [project]
status: {{input:Status|Planning}}
---
# {{title}}

**Goal:** {{input:Goal}}
**Started:** {{date}}

## Why

{{cursor}}

## Milestones

- [ ] 

## Links and resources

## Log

- {{date}}: Started.
`,
  "Person.md": `---
template-folder: People
tags: [person]
---
# {{title}}

**Role:** {{input:Role}}
**How we met:** {{input:How we met}}

## Notes

- {{date}}: {{cursor}}

## Follow-ups

- [ ] 
`,
  "Weekly review.md": `---
template-folder: Reviews
template-name: "Week of {{date:D MMMM YYYY}}"
tags: [review]
---
# Week of {{date:D MMMM YYYY}}

## What went well

- {{cursor}}

## What didn't

- 

## What I learned

- 

## Next week's priorities

1. 
`,
  "Map of content.md": `---
hub: true
template-name: "{{input:Topic}}"
---
# {{input:Topic}}

{{cursor}}What this area is about, in a sentence or two.

## Start here

- 

## Notes

- 

## Open questions

- 
`,
  "Daily.md": `# {{date:dddd D MMMM YYYY}}

## Plan

- [ ] {{cursor}}

## Notes

## Done
`,
};
