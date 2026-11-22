/**
 * Runs the embedding model off the main thread. The model and the ONNX
 * runtime are served by the app itself (public/models, public/ort), never a
 * CDN; the browser keeps them after the first download.
 */
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { MODEL_NAME, QUERY_PREFIX } from "./model";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: "/ort/ort-wasm-simd-threaded.mjs", wasm: "/ort/ort-wasm-simd-threaded.wasm" };
}

type Request = { id: number; texts: string[]; kind: "query" | "passage" };
const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Request>) => void) | null;
};

let model: Promise<FeatureExtractionPipeline> | null = null;
const load = () =>
  (model ??= pipeline("feature-extraction", MODEL_NAME, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx")) ctx.postMessage({ type: "progress", loaded: p.loaded ?? 0, total: p.total ?? 0 });
    },
  }) as Promise<FeatureExtractionPipeline>).catch((e) => {
    model = null;
    throw e;
  });

ctx.onmessage = async (e) => {
  const { id, texts, kind } = e.data;
  try {
    const fe = await load();
    const out = await fe(kind === "query" ? texts.map((t) => QUERY_PREFIX + t) : texts, { pooling: "cls", normalize: true });
    const dims = out.dims[out.dims.length - 1];
    const data = out.data as Float32Array;
    const vectors = texts.map((_, i) => data.slice(i * dims, (i + 1) * dims));
    ctx.postMessage({ type: "result", id, vectors }, vectors.map((v) => v.buffer));
  } catch (err) {
    ctx.postMessage({ type: "error", id, message: (err as Error)?.message ?? String(err) });
  }
};
