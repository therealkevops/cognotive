import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The companion bundle (npm run build:bridge).
    "bridge/dist/**",
    // Search by meaning: the copied ONNX runtime (scripts/fetch-semantic-assets.mjs).
    "public/ort/**",
    "public/models/**",
  ]),
]);

export default eslintConfig;
