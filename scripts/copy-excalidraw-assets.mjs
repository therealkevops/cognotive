// Copies Excalidraw's fonts into public/ so drawings load them from this app
// instead of a public CDN. Runs before `dev` and `build` (see package.json).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const to = join(root, "public/excalidraw/fonts");

if (!existsSync(from)) {
  console.warn("Excalidraw fonts not found; drawings will fall back to the CDN.");
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("Copied Excalidraw fonts to public/excalidraw/fonts");
