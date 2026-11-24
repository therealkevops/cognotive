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

/** A picture the plugin keeps outside the scene: its file id, and the file (or web address) it shows. */
export interface EmbeddedFile {
  id: string;
  /** The link's target ("Pasted Image 20230101.png"), or a web address. */
  target: string;
  url: boolean;
}

/** The "## Embedded Files" section: up to the next heading, "%%" or the end. */
const EMBEDDED = /^##\s+Embedded files\s*$([\s\S]*?)(?=^#{1,6}\s|^%%|(?![\s\S]))/im;

/**
 * The pictures an Obsidian drawing lists in its "## Embedded Files" section ("id: [[file]]"):
 * the plugin keeps them as files in the vault rather than inside the scene. LaTeX entries
 * ("id: $$…$$") aren't pictures this app can show, so they're left out.
 */
export function embeddedFiles(md: string): EmbeddedFile[] {
  const m = EMBEDDED.exec(md);
  if (!m) return [];
  const out: EmbeddedFile[] = [];
  for (const line of m[1].split("\n")) {
    const l = /^\s*([\w-]+):\s*(.+?)\s*$/.exec(line);
    if (!l) continue;
    const link = /^!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(l[2]);
    if (link) out.push({ id: l[1], target: link[1].trim(), url: false });
    else if (/^https?:\/\//i.test(l[2])) out.push({ id: l[1], target: l[2].split(/\s/)[0], url: true });
  }
  return out;
}

/**
 * The markdown with these pictures listed under "## Embedded Files" (as "id: [[target]]"),
 * added to the section (made, before the drawing, if there isn't one). Entries already
 * listed are left as they are.
 */
export function withEmbeddedFiles(md: string, files: Array<{ id: string; target: string }>): string {
  const listed = new Set(embeddedFiles(md).map((f) => f.id));
  const fresh = files.filter((f) => !listed.has(f.id));
  if (!fresh.length) return md;
  const lines = fresh.map((f) => `${f.id}: [[${f.target}]]`).join("\n");
  const m = EMBEDDED.exec(md);
  if (m) {
    const body = m[1].replace(/\s+$/, "");
    const start = m.index + m[0].length - m[1].length;
    return `${md.slice(0, start)}${body}\n${lines}\n\n${md.slice(m.index + m[0].length)}`;
  }
  // A new section, before the drawing (and the "%%" that hides it in Obsidian, if any).
  const at = /^(%%\s*\n)?##\s+Drawing\s*$/m.exec(md);
  const section = `## Embedded Files\n${lines}\n\n`;
  return at ? md.slice(0, at.index) + section + md.slice(at.index) : `${md.replace(/\s*$/, "\n\n")}${section}`;
}

/** A picture's contents for Excalidraw, or null if it can't be had. */
export type PictureLoader = (target: string) => Promise<{ dataURL: string; mimeType: string } | null>;

/**
 * A drawing's scene with the pictures its "## Embedded Files" section lists filled in (where
 * they can be loaded), for rendering it outside the editor: embeds and SVG copies. Pictures
 * already in the scene are left as they are; other drawings are returned unchanged.
 */
export async function sceneWithEmbedded(path: string, content: string, load: PictureLoader): Promise<string> {
  const json = drawingJson(path, content);
  const embedded = isObsidianDrawing(path) ? embeddedFiles(content).filter((f) => !f.url) : [];
  if (!embedded.length) return json;
  let data: { files?: Record<string, unknown> };
  try {
    data = JSON.parse(json);
  } catch {
    return json;
  }
  const files = { ...(data.files ?? {}) };
  let added = false;
  for (const f of embedded) {
    if (files[f.id]) continue;
    const picture = await load(f.target).catch(() => null);
    if (!picture) continue;
    files[f.id] = { id: f.id, dataURL: picture.dataURL, mimeType: picture.mimeType, created: 0 };
    added = true;
  }
  return added ? JSON.stringify({ ...data, files }) : json;
}

/**
 * The markdown with "## Embedded Files" entries pointing at a renamed or moved file
 * retargeted ("id: [[old.png]]" → "id: [[new.png]]", keeping any "|…" after it); null when
 * no entry matched.
 */
export function retargetEmbeddedFiles(md: string, matches: (target: string) => boolean, newText: string): string | null {
  const m = EMBEDDED.exec(md);
  if (!m) return null;
  let changed = false;
  const body = m[1].replace(/^(\s*[\w-]+:\s*!?\[\[)([^\]|#]+)((?:[#|][^\]]*)?\]\])/gm, (all, head: string, target: string, tail: string) => {
    if (!matches(target.trim())) return all;
    changed = true;
    return `${head}${newText}${tail}`;
  });
  if (!changed) return null;
  const start = m.index + m[0].length - m[1].length;
  return md.slice(0, start) + body + md.slice(m.index + m[0].length);
}
