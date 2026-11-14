import { compressToBase64, decompressFromBase64 } from "lz-string";

/**
 * The Obsidian Excalidraw plugin's file format: a markdown note ending in
 * ".excalidraw.md" whose scene sits in a fenced block under "## Drawing",
 * either as plain ```json or LZ-compressed ```compressed-json.
 */
const SCENE = /(##\s+Drawing\s*\n```)(json|compressed-json)\n([\s\S]*?)\n```/;

export function isObsidianDrawing(path: string): boolean {
  return path.toLowerCase().endsWith(".excalidraw.md");
}

export function extractScene(md: string): { json: string; format: "json" | "compressed-json" } | null {
  const m = SCENE.exec(md);
  if (!m) return null;
  const format = m[2] as "json" | "compressed-json";
  const json = format === "json" ? m[3] : decompressFromBase64(m[3].replace(/\s+/g, ""));
  return json ? { json, format } : null;
}

/** Puts a new scene back into the plugin's markdown, keeping its format and the rest of the note. */
export function replaceScene(md: string, json: string): string {
  const m = SCENE.exec(md);
  if (!m) return md;
  const format = m[2] as "json" | "compressed-json";
  // The plugin wraps compressed data at 256 characters per line.
  const data = format === "json" ? json : (compressToBase64(json).match(/.{1,256}/g) ?? []).join("\n\n");
  return md.slice(0, m.index) + `${m[1]}${format}\n${data}\n\`\`\`` + md.slice(m.index + m[0].length);
}

/** The Excalidraw JSON of a drawing file in either format ("" if it can't be read). */
export function drawingJson(path: string, content: string): string {
  return isObsidianDrawing(path) ? (extractScene(content)?.json ?? "") : content;
}
