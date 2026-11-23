@AGENTS.md

# CogNotive.ai

- Design and roadmap: `docs/PLAN.md`; AI and agent features: `docs/AI_PLAN.md`. Read the relevant
  one before starting a phase.
- Target is Vercel **Hobby**: keep work in the browser, with no server routes. GitHub sync uses a
  token in the browser, and AI providers (OpenRouter, a local server, any OpenAI-compatible
  endpoint) are called straight from the browser with keys kept on the device
  (`src/lib/ai/keys.ts`). Don't proxy note files, attachments or AI requests through functions.
  The optional companion in `bridge/` (Claude plan bridge and MCP server) runs on the user's own
  computer, never on Vercel; it reuses `src/lib` and is bundled with `npm run build:bridge`.
- Before committing, run `npm run check` and `npm run build`; for UI changes also
  `npm run test:e2e`.
- No emoji anywhere in the app: not in UI text, messages, AI prompts or anything written into notes
  (use words or lucide icons). `src/lib/no-emoji.test.ts` enforces it; the task parser may still
  read Obsidian's emoji markers in existing notes.
- Search by meaning (`src/lib/semantic/`) runs a model in a Web Worker; the model and ONNX runtime
  are served from `public/` (fetched by `scripts/fetch-semantic-assets.mjs`), never a CDN. Tests use
  the word-hashing engine (`localStorage["noted-ai:semanticEngine"] = "hash"`); one e2e test runs
  the real model from `public/models`.
- Unit tests sit next to the code as `*.test.ts(x)`; e2e tests live in `tests/e2e/`.
- Sync logic lives in `src/lib/sync/` and is tested against `FakeRemote`; e2e tests fake the
  GitHub API in the browser with `tests/e2e/fake-github.ts`. Never call real GitHub in tests.
- AI code lives in `src/lib/ai/` (unit tests stub `fetch`); e2e tests fake OpenRouter and a local
  Ollama in the browser with `tests/e2e/fake-llm.ts`. Never call a real AI provider in tests.
  Bridge tests run a fake `claude` (`bridge/test/fake-claude.mjs`), never the real Claude Code.
