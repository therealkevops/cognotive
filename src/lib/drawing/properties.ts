import { parse as parseYaml } from "yaml";
import { setFrontmatterProperty, splitFrontmatter } from "../markdown/frontmatter";
import { yamlValue } from "../editor/properties";
import { isObsidianDrawing } from "./obsidian";

/**
 * Properties of a drawing. The Obsidian Excalidraw plugin's ".excalidraw.md"
 * files keep them in YAML frontmatter, like notes. Plain ".excalidraw" files
 * keep them under a top-level "properties" key in the JSON, which Excalidraw
 * ignores when it opens the file.
 */

/** The plugin's own frontmatter keys ("excalidraw-plugin: parsed"…): kept, but not shown for editing. */
export const isPluginKey = (key: string) => /^excalidraw-/.test(key);

export function drawingProperties(path: string, content: string): Record<string, unknown> {
  try {
    if (isObsidianDrawing(path)) {
      const fm = splitFrontmatter(content).frontmatter;
      if (!fm) return {};
      const data = parseYaml(fm.replace(/^---\r?\n/, "").replace(/\r?\n---[ \t]*(\r?\n)?$/, ""));
      return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    }
    const props = (JSON.parse(content) as { properties?: unknown }).properties;
    return props && typeof props === "object" && !Array.isArray(props) ? (props as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Sets (or, with undefined, removes) a property of a drawing; the drawing itself is untouched. */
export function setDrawingProperty(path: string, content: string, key: string, value: unknown): string {
  if (isObsidianDrawing(path)) {
    return setFrontmatterProperty(content, key, value === undefined ? undefined : yamlValue(value));
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return content;
  }
  const props = { ...drawingProperties(path, content) };
  if (value === undefined) delete props[key];
  else props[key] = value;
  if (Object.keys(props).length) data.properties = props;
  else delete data.properties;
  return JSON.stringify(data, null, 2);
}

/**
 * A plain drawing as Excalidraw saves it, with the properties of the previous
 * version carried over (Excalidraw doesn't know about them).
 */
export function keepDrawingProperties(path: string, saved: string, previous: string): string {
  if (isObsidianDrawing(path)) return saved;
  const props = drawingProperties(path, previous);
  if (!Object.keys(props).length) return saved;
  try {
    const data = JSON.parse(saved) as Record<string, unknown>;
    data.properties = props;
    return JSON.stringify(data, null, 2);
  } catch {
    return saved;
  }
}
