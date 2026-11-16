import { addMissingProperties } from "../markdown/frontmatter";
import { formatDate } from "./settings";

/** Properties noted-ai understands, offered in Settings → This repository → Properties for new notes. */
export const KNOWN_PROPERTIES: Array<{ key: string; description: string; value(now: Date): string }> = [
  { key: "created", description: "Today's date, filled in", value: (now) => formatDate(now, "YYYY-MM-DD") },
  { key: "tags", description: "Tags, as in tags: [idea, work]", value: () => "[]" },
  { key: "aliases", description: "Other names that links can use", value: () => "[]" },
  { key: "hub", description: "true pins the note to the sidebar as a hub", value: () => "" },
  { key: "reviewed", description: "When you last checked it was still accurate", value: () => "" },
];

/** A property name that can be written as `name:` in YAML without quoting. */
export const PROPERTY_NAME = /^[A-Za-z][\w-]*$/;

/** A new note's content with the chosen properties added (values for known ones, empty for others). */
export function withNewNoteProperties(content: string, keys: string[], now = new Date()): string {
  const entries = keys
    .filter((k) => PROPERTY_NAME.test(k))
    .map((k): [string, string] => [k, KNOWN_PROPERTIES.find((p) => p.key === k)?.value(now) ?? ""]);
  return entries.length ? addMissingProperties(content, entries) : content;
}
