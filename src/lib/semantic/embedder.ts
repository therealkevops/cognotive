/**
 * Turns text into vectors whose closeness means closeness in meaning. The app
 * uses a small model in a Web Worker (worker-embedder.ts); tests use the
 * HashEmbedder, which only matches shared words but needs no model.
 */
export interface Embedder {
  /** Identifies the model: vectors from different models aren't comparable. */
  readonly id: string;
  /** Results scoring below this are left out when only meaning matched. */
  readonly minScore: number;
  embed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]>;
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Dot product: cosine similarity for normalized vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");

/** Words hashed into a fixed-size vector: deterministic and instant, for tests (and as a fallback). */
export class HashEmbedder implements Embedder {
  readonly id = "hash-v1";
  readonly minScore = 0.2;
  constructor(private readonly dims = 256) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (const raw of t.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
        const w = stem(raw);
        let h = 2166136261;
        for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
        v[(h >>> 0) % this.dims] += h & 1 ? 1 : -1;
      }
      return normalize(v);
    });
  }
}
