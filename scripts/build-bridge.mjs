// Bundles the companion (bridge and MCP server) into one file that runs on
// plain Node: bridge/dist/k-note.mjs.
import { build } from "rolldown";

await build({
  input: "bridge/src/main.ts",
  platform: "node",
  logLevel: "warn",
  output: { file: "bridge/dist/k-note.mjs", format: "esm", banner: "#!/usr/bin/env node" },
});
console.log("Built bridge/dist/k-note.mjs");
