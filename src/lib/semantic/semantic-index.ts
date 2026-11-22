import { chunkNote, contentHash, passageText } from "./chunk";
import { dot, normalize, type Embedder } from "./embedder";

/** A note's passages and their vectors, as stored. */
export interface StoredNote {
  model: string;
  hash: string;
  chunks: Array<{ heading?: string; from: number; preview: string; vector: Float32Array }>;
}

/** Where vectors are kept between visits (IndexedDB in the app, memory in tests). */
export interface VectorStore {
  all(): Promise<Map<string, StoredNote>>;
  put(path: string, note: StoredNote): Promise<void>;
  delete(path: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SemanticHit {
  path: string;
  score: number;
  /** The passage that matched best. */
  heading?: string;
  from: number;
  preview: string;
}

const PREVIEW = 220;
const BATCH = 16;

export class MemoryVectorStore implements VectorStore {
  notes = new Map<string, StoredNote>();
  async all() {
    return new Map(this.notes);
  }
  async put(path: string, note: StoredNote) {
    this.notes.set(path, note);
  }
  async delete(path: string) {
    this.notes.delete(path);
  }
  async clear() {
    this.notes.clear();
  }
}

/**
 * Vectors for every note's passages, kept up to date by `sync` (only changed
 * notes are embedded again) and searched by brute force, which is quick for
 * the few thousand passages a personal repository has.
 */
export class SemanticIndex {
  private notes = new Map<string, StoredNote>();
  private loaded = false;

  constructor(
    private readonly store: VectorStore,
    readonly embedder: Embedder,
  ) {}

  get size() {
    return this.notes.size;
  }

  has(path: string) {
    return this.notes.has(path);
  }

  async load() {
    if (this.loaded) return;
    const stored = await this.store.all();
    for (const [p, n] of stored) {
      if (n.model === this.embedder.id) this.notes.set(p, n);
      else await this.store.delete(p);
    }
    this.loaded = true;
  }

  /** How many of these notes need embedding. */
  pending(files: Array<{ path: string; content: string }>): number {
    return files.filter((f) => this.notes.get(f.path)?.hash !== contentHash(f.content)).length;
  }

  /**
   * Brings the index in line with `files`: embeds new and changed notes (a
   * batch of passages at a time, reporting progress) and forgets removed ones.
   */
  async sync(
    files: Array<{ path: string; title: string; content: string }>,
    opts: { signal?: AbortSignal; onProgress?(done: number, total: number): void } = {},
  ) {
    await this.load();
    const keep = new Set(files.map((f) => f.path));
    for (const p of [...this.notes.keys()]) {
      if (!keep.has(p)) {
        this.notes.delete(p);
        await this.store.delete(p);
      }
    }
    const todo = files.filter((f) => this.notes.get(f.path)?.hash !== contentHash(f.content));
    let done = 0;
    opts.onProgress?.(0, todo.length);
    for (const f of todo) {
      if (opts.signal?.aborted) return;
      const chunks = chunkNote(f.content);
      const texts = chunks.length ? chunks.map((c) => passageText(f.title, c)) : [f.title];
      const vectors: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH) vectors.push(...(await this.embedder.embed(texts.slice(i, i + BATCH), "passage")));
      if (opts.signal?.aborted) return;
      const note: StoredNote = {
        model: this.embedder.id,
        hash: contentHash(f.content),
        chunks: (chunks.length ? chunks : [{ from: 0, text: f.title }]).map((c, i) => ({
          ...(c.heading ? { heading: c.heading } : {}),
          from: c.from,
          preview: c.text.slice(0, PREVIEW),
          vector: vectors[i],
        })),
      };
      this.notes.set(f.path, note);
      await this.store.put(f.path, note);
      opts.onProgress?.(++done, todo.length);
    }
  }

  /** Notes ranked by their best-matching passage. */
  async search(query: string, limit = 10): Promise<SemanticHit[]> {
    if (!query.trim() || !this.notes.size) return [];
    const [q] = await this.embedder.embed([query], "query");
    return this.rank(q, limit, () => false);
  }

  /** Notes closest in meaning to `path` (by the average of its passages). */
  similar(path: string, limit = 5): SemanticHit[] {
    const n = this.notes.get(path);
    if (!n?.chunks.length) return [];
    const centre = new Float32Array(n.chunks[0].vector.length);
    for (const c of n.chunks) for (let i = 0; i < centre.length; i++) centre[i] += c.vector[i];
    return this.rank(normalize(centre), limit, (p) => p === path);
  }

  private rank(q: Float32Array, limit: number, skip: (path: string) => boolean): SemanticHit[] {
    const hits: SemanticHit[] = [];
    for (const [path, n] of this.notes) {
      if (skip(path)) continue;
      let best: SemanticHit | null = null;
      for (const c of n.chunks) {
        const score = dot(q, c.vector);
        if (!best || score > best.score) best = { path, score, from: c.from, preview: c.preview, ...(c.heading ? { heading: c.heading } : {}) };
      }
      if (best && best.score >= this.embedder.minScore) hits.push(best);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async clear() {
    this.notes.clear();
    await this.store.clear();
  }
}
