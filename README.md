# noted-ai

Markdown notes with wikilinks, a knowledge graph, Excalidraw drawings and an LLM that can
explore them. Notes are stored in a GitHub repository you choose (or locally in the browser).

See [docs/PLAN.md](docs/PLAN.md) for the design and the phase plan.

**Status:** phase 0 (scaffold). The app shell deploys; nothing is editable yet.

## Develop

Requires Node 22 (see `.nvmrc`).

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates Next.js route types, then `tsc --noEmit` |
| `npm test` | Unit tests (Vitest, files named `*.test.ts(x)` next to the code) |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright tests against the production build (run `npm run build` first) |
| `npm run check` | Lint, typecheck and unit tests together |

The first time you run the e2e tests locally, install the browser with
`npx playwright install chromium`.

CI (`.github/workflows/ci.yml`) runs all of the above on every push to `main` and on pull requests.

## Deploy to Vercel (Hobby)

1. In Vercel, **Add New → Project** and import `therealkevops/noted-ai`.
2. Keep the detected defaults (Framework: Next.js, build `next build`). No environment
   variables are needed yet; `.env.example` lists the ones later phases add.
3. Deploy. Every push to `main` deploys to production; other branches get preview URLs.

Check a deployment at `/api/health`, which reports the commit it was built from.

The app is designed for the Hobby plan's limits: pages and `/api/health` are static, and
later phases keep server functions to GitHub login and a thin Claude proxy. See
[docs/PLAN.md § Guiding constraints](docs/PLAN.md#1-guiding-constraints).

## Layout

```
src/app/            routes (App Router); src/app/api/* are server route handlers
src/components/     React components
src/lib/            framework-free logic (parsers, stores, sync) with unit tests alongside
tests/e2e/          Playwright tests
docs/PLAN.md        design and roadmap
```
