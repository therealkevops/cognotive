import { splitFrontmatter } from "../markdown/frontmatter";

/**
 * Notes cut into passages for search by meaning: by heading, then paragraphs
 * packed up to about CHUNK_SIZE characters. Each passage is embedded with the
 * note's title and heading in front, so short passages keep their context.
 */
export interface Chunk {
  heading?: string;
  /** Offset of the passage in the note (to open the note there). */
  from: number;
  /** The passage, as written. */
  text: string;
}

export const CHUNK_SIZE = 700;
export const MAX_CHUNKS = 60;
/** Bump when chunking changes, so stored vectors are rebuilt. */
export const CHUNKER_VERSION = 1;

export function chunkNote(content: string): Chunk[] {
  const body = splitFrontmatter(content).body;
  const base = content.length - body.length;
  const chunks: Chunk[] = [];
  let heading: string | undefined;
  let buf = "";
  let bufFrom = -1;
  let inFence = false;
  const flush = () => {
    const text = buf.trim();
    if (text) chunks.push({ ...(heading ? { heading } : {}), from: base + bufFrom, text });
    buf = "";
    bufFrom = -1;
  };
  const add = (para: string, at: number) => {
    if (buf && buf.length + para.length > CHUNK_SIZE) flush();
    if (bufFrom < 0) bufFrom = at;
    buf += (buf ? "\n\n" : "") + para;
    // A single long paragraph is cut at sentence ends.
    while (buf.length > CHUNK_SIZE * 1.5) {
      const cut = buf.slice(0, CHUNK_SIZE).search(/[.!?]\s[^.!?]*$/);
      const at2 = cut > CHUNK_SIZE / 3 ? cut + 1 : CHUNK_SIZE;
      const rest = buf.slice(at2).trimStart();
      const restFrom = bufFrom + (buf.length - rest.length);
      buf = buf.slice(0, at2);
      flush();
      buf = rest;
      bufFrom = restFrom;
    }
  };

  let para = "";
  let paraFrom = 0;
  let offset = 0;
  for (const line of body.split("\n")) {
    const lineFrom = offset;
    offset += line.length + 1;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h || (!inFence && !line.trim())) {
      if (para) add(para, paraFrom);
      para = "";
      if (h) {
        flush();
        heading = h[1];
      }
      continue;
    }
    if (!para) paraFrom = lineFrom;
    para += (para ? "\n" : "") + line;
  }
  if (para) add(para, paraFrom);
  flush();
  return chunks.slice(0, MAX_CHUNKS);
}

/** What's embedded for a passage: where it's from, then the passage. */
export function passageText(title: string, chunk: Pick<Chunk, "heading" | "text">): string {
  return `${title}${chunk.heading ? ` › ${chunk.heading}` : ""}\n${chunk.text}`;
}

/** A short, stable fingerprint of a note's text (FNV-1a), to tell when it needs embedding again. */
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${CHUNKER_VERSION}:${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${text.length}`;
}
