// Puts what "search by meaning" needs into public/, so the app serves it itself
// instead of a CDN: the ONNX runtime's WebAssembly (from node_modules) and the
// embedding model (downloaded once from Hugging Face, then kept). Runs before
// `dev` and `build`. Without network, the build still succeeds; the app then
// says the model isn't available.
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The runtime: the plain SIMD build (the smallest; the app runs on the CPU).
const ort = join(root, "node_modules/onnxruntime-web/dist");
const ortOut = join(root, "public/ort");
rmSync(ortOut, { recursive: true, force: true });
mkdirSync(ortOut, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) cpSync(join(ort, f), join(ortOut, f));
console.log("Copied the ONNX runtime to public/ort");

// The model: BGE small (English), 8-bit, about 34 MB.
export const MODEL = "Xenova/bge-small-en-v1.5";
const files = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx"];
const modelOut = join(root, "public/models", MODEL);
let fetched = 0;
for (const f of files) {
  const to = join(modelOut, f);
  if (existsSync(to) && statSync(to).size > 0) continue;
  try {
    const res = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${f}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, Buffer.from(await res.arrayBuffer()));
    fetched++;
  } catch (e) {
    console.warn(`Couldn't download ${MODEL}/${f} (${e.message}); search by meaning won't be available in this build.`);
    process.exit(0);
  }
}
console.log(fetched ? `Downloaded ${MODEL} to public/models` : `${MODEL} is already in public/models`);
