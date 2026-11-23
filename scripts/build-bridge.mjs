// Bundles the companion (bridge and MCP server) into one file that runs on
// plain Node: bridge/dist/cognotive.mjs.
import { build } from "rolldown";

await build({
  input: "bridge/src/main.ts",
  platform: "node",
  logLevel: "warn",
  output: { file: "bridge/dist/cognotive.mjs", format: "esm", banner: "#!/usr/bin/env node" },
});
console.log("Built bridge/dist/cognotive.mjs");
