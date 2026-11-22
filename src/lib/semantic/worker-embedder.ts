import type { Embedder } from "./embedder";
import { MIN_SCORE, MODEL_ID } from "./model";

type Reply =
  | { type: "result"; id: number; vectors: Float32Array[] }
  | { type: "error"; id: number; message: string }
  | { type: "progress"; loaded: number; total: number };

/** The model in a Web Worker. Started on first use; `onDownload` reports the model's first download. */
export class WorkerEmbedder implements Embedder {
  readonly id = MODEL_ID;
  readonly minScore = MIN_SCORE;
  private worker: Worker | null = null;
  private next = 0;
  private waiting = new Map<number, { resolve(v: Float32Array[]): void; reject(e: Error): void }>();

  constructor(private readonly onDownload?: (loaded: number, total: number) => void) {}

  private start(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<Reply>) => {
      const m = e.data;
      if (m.type === "progress") return this.onDownload?.(m.loaded, m.total);
      const p = this.waiting.get(m.id);
      if (!p) return;
      this.waiting.delete(m.id);
      if (m.type === "result") p.resolve(m.vectors);
      else p.reject(new Error(m.message));
    };
    w.onerror = (e) => {
      for (const p of this.waiting.values()) p.reject(new Error(e.message || "The search model stopped."));
      this.waiting.clear();
      this.worker = null;
    };
    return (this.worker = w);
  }

  embed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.start().postMessage({ id, texts, kind });
    });
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.waiting.values()) p.reject(new Error("Stopped."));
    this.waiting.clear();
  }
}
