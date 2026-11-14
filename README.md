# noted-ai

Markdown notes with wikilinks, a knowledge graph, Excalidraw drawings and an LLM that can
explore them. Notes are stored in a GitHub repository you choose (or locally in the browser).

See [docs/PLAN.md](docs/PLAN.md) for the design and the phase plan.

**Status:** phase 1 (local editor). Notes are stored in this browser's IndexedDB; GitHub
storage arrives in phase 2.

### What works
- File tree: create, rename (double-click, F2 or the pencil), delete, and drag notes or
  folders into other folders
- Editor (CodeMirror 6) with three modes: live preview, source, and reading
- Formatting toolbar and shortcuts; `==highlight==`; task lists with clickable checkboxes
- Reading view: GitHub-flavoured markdown, KaTeX maths, Mermaid diagrams, highlighted code,
  Obsidian-style callouts (`> [!tip]`)
- Quick switcher (Ctrl/Cmd+O) that also creates notes; full-text search (Ctrl/Cmd+Shift+F)
- Outline of the open note's headings
- Autosave (400 ms after you stop typing, and when the tab is hidden)

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
src/components/     React components (workspace/ = the editor UI, vault/ = vault state)
src/lib/            framework-free logic with unit tests alongside:
  vault/            VaultStore interface, LocalStore (IndexedDB), paths, folder tree
  editor/           CodeMirror setup, formatting commands, live preview
  markdown/         reading-view renderer (unified/remark/rehype), outline
  search/           keyword index (MiniSearch)
tests/e2e/          Playwright tests
docs/PLAN.md        design and roadmap
```
