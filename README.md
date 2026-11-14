# noted-ai

Markdown notes with wikilinks, a knowledge graph, Excalidraw drawings and an LLM that can
explore them. Notes are stored in a GitHub repository you choose (or locally in the browser).

See [docs/PLAN.md](docs/PLAN.md) for the design and the phase plan.

**Status:** phases 1–4 and 6 are done; phase 5 (the LLM) is postponed. Vaults live in this browser or in GitHub repositories.

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
- Links between notes, as in Obsidian:
  - `[[Note]]`, `[[Note#Heading]]`, `[[Note|text]]`, and markdown links to `.md` files
  - typing `[[` suggests notes, aliases and (after `#`) headings; hovering a link previews the note
  - click a link in live preview (or Ctrl/Cmd-click anywhere) to follow it; links to missing
    notes are dashed and create the note when followed
  - `![[Note]]` and `![[Note#Heading]]` embed another note in the reading view
  - renaming or moving a note rewrites every link to it
- Links panel: backlinks with context, unlinked mentions (with a one-click **Link** button),
  and outgoing links
- Tags (`#tag`, `#nested/tag`, or `tags:` in properties) with a Tags pane; search `tag:name`
- Properties (YAML frontmatter) shown at the top of the reading view; `aliases:` count as names
- Graph view (Ctrl/Cmd+G) of the whole vault with highlight, tag filter, unlinked notes and
  not-yet-created notes; a local graph of the open note in the right panel
- Excalidraw drawings (`.excalidraw` files): create with the pen button in the file tree, edit
  full-screen, embed with `![[Drawing.excalidraw]]` (rendered as SVG, click to open). Element
  links like `[[Note]]` and links in drawing text count as links, so drawings appear in
  backlinks and as squares in the graph; drawing text is searchable
- Attachments: paste or drop images into a note (saved to `attachments/` and embedded as
  `![[Pasted image ….png]]`), add files with the upload button or by dropping them on a folder,
  and open images, PDFs, audio and video. `![[pic.png|300]]` sets an image's width
- Live preview renders tables and `![[Note]]` embeds in place, and highlights `#tags`;
  `[[Note#^block]]` links scroll to the block
- Command palette (Ctrl/Cmd+P) for every action
- Daily notes (the **Today** button, or Ctrl/Cmd+Shift+D) and templates with `{{title}}`,
  `{{date}}`, `{{time}}` and `{{date:FORMAT}}`, inserted from the palette
- Tabs for open files, and a side pane to read one note while writing another (the columns
  button in the file tree, or Shift+Enter in the quick switcher)
- Version history for GitHub vaults: see how a note changed and restore an older version
- Export a vault as a zip, and import notes from one (e.g. a zipped Obsidian vault)
- Appearance settings per browser (theme, accent colour, text size, line width), and vault
  settings kept in `.noted/settings.json` (attachment folder, daily notes, templates, SVG
  copies of drawings)
- Drawings also open from the Obsidian Excalidraw plugin's `.excalidraw.md` files; Excalidraw's
  fonts are served by the app itself, not a CDN
- Installable as an app (desktop or phone) that opens offline; notes are kept in the browser
- Several vaults, with a switcher at the top of the sidebar
- GitHub vaults: sign in with GitHub, pick a repository, branch and optional subfolder.
  Notes sync both ways; see [How sync works](#how-sync-works)

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

## Set up GitHub storage

GitHub vaults need a **GitHub App**, which is how the app signs you in and gets access to
only the repositories you choose. One-time setup:

1. **Create the app** at <https://github.com/settings/apps/new>:
   - **GitHub App name:** anything unique, e.g. `noted-ai-<you>`
   - **Homepage URL:** your Vercel production URL
   - **Callback URL:** `https://<your-vercel-domain>/api/auth/callback`. Use *Add Callback URL*
     to also add `http://localhost:3000/api/auth/callback` for local development.
   - Leave **Expire user authorization tokens** ticked.
   - Tick **Request user authorization (OAuth) during installation**.
   - **Webhook:** untick *Active*.
   - **Permissions → Repository permissions → Contents:** *Read and write*. (Metadata: read-only
     is added automatically.) No other permissions.
   - **Where can this GitHub App be installed?** *Only on this account*.
2. On the app's page, note the **Client ID**, click **Generate a new client secret**, and note
   the app's URL name (the *slug*, from `github.com/apps/<slug>`).
3. **Install the app** (left menu → *Install App*) and choose the repository or repositories
   that will hold notes. A new, empty private repo is fine.
4. In **Vercel → Project → Settings → Environment Variables**, add the variables from
   `.env.example`:

   | Variable | Value |
   |---|---|
   | `GITHUB_APP_CLIENT_ID` | the Client ID |
   | `GITHUB_APP_CLIENT_SECRET` | the client secret |
   | `GITHUB_APP_SLUG` | the slug |
   | `SESSION_SECRET` | output of `openssl rand -base64 32` |
   | `ALLOWED_GITHUB_USER_IDS` | your numeric GitHub id (see `https://api.github.com/users/<login>`), so nobody else can sign in |

5. **Redeploy**, open the app, go to **Settings → Connect a GitHub repository**.

Sign-in works on the URLs listed as callback URLs. Vercel preview deployments have their own
URLs, so sign-in on a preview needs that URL added too; local vaults work everywhere.

### How sync works

- The browser talks to `api.github.com` directly with your token; note contents never pass
  through Vercel. The only server routes are `/api/auth/*`, which keep the refresh token in an
  encrypted httpOnly cookie and hand the browser short-lived access tokens.
- Edits are saved in the browser first, so the app works offline. **Automatic** sync commits
  30 seconds (configurable) after you stop typing, when you leave the tab, and when you switch
  vaults; it also checks GitHub for changes when you come back to the tab and every 5 minutes.
  **Manual** sync commits only when you press the sync button.
- All pending edits go up as one commit, e.g. `noted-ai: update Groceries, Plan`.
- Changes from elsewhere (Obsidian, GitHub's editor, another device) come down on the next sync.
  If the same note changed in both places, edits to different lines are merged. If the same
  lines changed, GitHub's version stays and yours is saved next to it as
  `Note (conflict YYYY-MM-DD).md`. Nothing is overwritten.
- Notes, drawings and other text files (`.md`, `.excalidraw`, `.canvas`, `.json`, `.txt`,
  `.csv`) sync, and so do attachments (images, PDFs, audio, video) as binary files. Hidden
  folders such as `.obsidian/` and other file types are left untouched in the repo.
- Drawings and attachments are never line-merged: if one changed in both places, you get a
  conflict copy.

## Layout

```
src/app/            routes (App Router); src/app/api/auth/* is GitHub sign-in
src/components/     React components (workspace/ = the editor UI, vault/ = vault state)
src/lib/            framework-free logic with unit tests alongside:
  vault/            VaultStore interface, LocalStore (IndexedDB), paths, folder tree
  editor/           CodeMirror setup, formatting commands, live preview
  markdown/         reading-view renderer (unified/remark/rehype), outline
  search/           keyword index (MiniSearch)
  github/           browser GitHub REST client
  sync/             sync engine (three-way, conflict copies), remote adapter, sync state
  server/           sign-in helpers used by the auth routes (session cookie, OAuth)
  links/            link and tag parsing, Obsidian-style resolution, LinkIndex (backlinks,
                    mentions, graph, rename rewriting)
  drawing/          Excalidraw file parsing (text, links), link rewriting, SVG rendering
tests/e2e/          Playwright tests
docs/PLAN.md        design and roadmap
```
