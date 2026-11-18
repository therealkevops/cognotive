import { isObsidianDrawing } from "../drawing/obsidian";
import { setDrawingProperty } from "../drawing/properties";
import { yamlValue } from "../editor/properties";
import { setFrontmatterProperty, splitFrontmatter } from "../markdown/frontmatter";
import { isCanvas, isDrawing, isNote } from "./paths";

/**
 * Renaming or deleting a property across files. Notes and the Obsidian
 * plugin's drawings keep properties in YAML frontmatter; plain drawings and
 * canvases under a "properties" key in their JSON.
 */

const keyLine = (key: string) => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*:)`);

function isYaml(path: string) {
  return (isNote(path) && !isDrawing(path)) || isObsidianDrawing(path);
}

function isJson(path: string) {
  return (isDrawing(path) && !isObsidianDrawing(path)) || isCanvas(path);
}

/**
 * The file with property `from` renamed to `to`, keeping its value and place.
 * "unchanged" if it doesn't have `from`; "clash" if it already has `to`.
 */
export function renamePropertyIn(path: string, content: string, from: string, to: string): string | "unchanged" | "clash" {
  if (isYaml(path)) {
    const { frontmatter, body } = splitFrontmatter(content);
    if (!frontmatter) return "unchanged";
    const lines = frontmatter.split("\n");
    const at = lines.findIndex((l, i) => i > 0 && keyLine(from).test(l));
    if (at === -1) return "unchanged";
    if (lines.some((l, i) => i > 0 && keyLine(to).test(l))) return "clash";
    lines[at] = lines[at].replace(keyLine(from), `${to}$1`);
    return lines.join("\n") + body;
  }
  if (isJson(path)) {
    try {
      const data = JSON.parse(content) as Record<string, unknown>;
      const props = data.properties as Record<string, unknown> | undefined;
      if (!props || typeof props !== "object" || !(from in props)) return "unchanged";
      if (to in props) return "clash";
      data.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k === from ? to : k, v]));
      return JSON.stringify(data, null, isCanvas(path) ? "\t" : 2) + (isCanvas(path) ? "\n" : "");
    } catch {
      return "unchanged";
    }
  }
  return "unchanged";
}

/** The file without property `key`; "unchanged" if it didn't have it. */
export function deletePropertyIn(path: string, content: string, key: string): string | "unchanged" {
  if (isYaml(path)) {
    const next = setFrontmatterProperty(content, key, undefined);
    return next === content ? "unchanged" : next;
  }
  if (isJson(path)) {
    try {
      const data = JSON.parse(content) as Record<string, unknown>;
      const props = data.properties as Record<string, unknown> | undefined;
      if (!props || typeof props !== "object" || !(key in props)) return "unchanged";
      const rest = { ...props };
      delete rest[key];
      if (Object.keys(rest).length) data.properties = rest;
      else delete data.properties;
      return JSON.stringify(data, null, isCanvas(path) ? "\t" : 2) + (isCanvas(path) ? "\n" : "");
    } catch {
      return "unchanged";
    }
  }
  return "unchanged";
}

/**
 * The file with property `key` set to `value` (undefined removes it), for any
 * text file that holds properties; "unchanged" for other files.
 */
export function setPropertyIn(path: string, content: string, key: string, value: unknown): string | "unchanged" {
  if (isYaml(path)) {
    const next = setFrontmatterProperty(content, key, value === undefined ? undefined : yamlValue(value));
    return next === content ? "unchanged" : next;
  }
  if (isDrawing(path)) {
    const next = setDrawingProperty(path, content, key, value);
    return next === content ? "unchanged" : next;
  }
  if (isCanvas(path)) {
    try {
      const data = JSON.parse(content) as Record<string, unknown>;
      const props = { ...((data.properties as Record<string, unknown> | undefined) ?? {}) };
      if (value === undefined) delete props[key];
      else props[key] = value;
      if (Object.keys(props).length) data.properties = props;
      else delete data.properties;
      const next = JSON.stringify(data, null, "\t") + "\n";
      return next === content ? "unchanged" : next;
    } catch {
      return "unchanged";
    }
  }
  return "unchanged";
}
