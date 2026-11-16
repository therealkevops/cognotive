# noted-ai

Markdown notes with links between them, Excalidraw drawings, canvases and (later) an LLM that
can explore them. Each **repository** of notes lives in the browser, and can sync with a GitHub
repository you choose.

See [docs/PLAN.md](docs/PLAN.md) for the design and the phase plan.

**Status:** phases 1–4 and 6 are done; phase 5 (the LLM) is postponed. Repositories live in this browser and can sync with GitHub.

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
  - in live preview a click edits a link; the ↗ after it, Alt+Enter, or Ctrl/Cmd-click follows
    it (Settings → Editor can make a click follow). Ctrl/Cmd-click opens a new tab,
    Ctrl/Cmd+Alt-click the side pane; Back and Forward retrace your steps
  - links to missing notes are dashed; opening one asks where to create the note
  - `[[Note#^` suggests blocks and adds the `^id` for you; links can be written as markdown
    links instead (Settings → This repository) so they work on github.com
  - `![[Note]]` and `![[Note#Heading]]` embed another note in the reading view
  - renaming or moving a note rewrites every link to it
- Connections panel: backlinks with context, outgoing links, notes that share links with this
  one, notes with the same tags, canvas relations, and unlinked mentions (with a one-click
  **Link** button). **Map as canvas** lays a note and its connections out on a canvas
- Tags (`#tag`, `#nested/tag`, or `tags:` in properties) with a Tags pane; search `tag:name`
- Properties (YAML frontmatter) shown at the top of the reading view; `aliases:` count as names
- Repository health: a score out of 100 with totals and a heatmap of recent changes; a link map
  of the whole repository (hubs large, orphans loose, missing notes as dashed stubs; hover to see a
  note's links, click to open it or create a missing one); and cards for broken links, orphans,
  dead ends, hubs and stale hubs (well-linked notes not changed or reviewed in six months; **Mark
  reviewed** records `reviewed: YYYY-MM-DD` in the note) that open lists to act on. Hubs are notes well above average in
  links in, index notes linking out to many, and notes pinned with `hub: true` (with the command
  *Pin this note to the sidebar as a hub*, or **Pin** in the Hubs list; `hub: false` opts a note
  out). Pinned hubs are listed at the top of the sidebar's Files tab; missing notes linked from three or more
  notes are listed as hubs waiting to be written. Quick fixes: create a missing note,
  link an orphan from a note that mentions it, link a dead end to a note it mentions, or ignore a
  note (kept in `.noted/settings.json`); the score updates as you go, with a count of what you fixed
  today
- Canvases (`.canvas`, the JSON Canvas format Obsidian uses): cards for text, notes, images,
  drawings and web links, groups, and labelled arrows, which become typed relations
- Excalidraw drawings (`.excalidraw` files): create with the pen button in the file tree, edit
  full-screen, embed with `![[Drawing.excalidraw]]` (rendered as SVG, click to open). Element
  links like `[[Note]]` and links in drawing text count as links, so drawings appear in
  backlinks; drawing text is searchable
- Attachments: paste or drop images into a note (saved to `attachments/` and embedded as
  `![[Pasted image ….png]]`), add files with the upload button or by dropping them on a folder,
  and open images, PDFs, audio and video. `![[pic.png|300]]` sets an image's width
- Live preview renders `![[Note]]` embeds in place, and highlights `#tags`;
  `[[Note#^block]]` links scroll to the block
- Tables: in live preview a table is a grid you type in (notes still store ordinary markdown
  tables, with the columns lined up)
  - Tab and Shift+Tab move between cells (Tab after the last cell adds a row), Enter goes down a
    row, Shift+Enter adds a line break (`<br>`), and the arrow keys or Escape leave the table
  - Right-click a cell (or the ⋯ button above the table) to insert, move or delete rows and
    columns, align a column, sort by it, or delete the table; Alt+arrows move a row or column; the
    + buttons add a row or column
  - The toolbar's table button picks a size; cells copied from a spreadsheet paste as a table, and
    a block pasted into a cell spreads across the cells
  - Settings → Editor → *Tables in live preview* can show tables as markdown instead. There (and in
    source mode) Tab and Enter still move between cells and line the columns up, and Ctrl/Cmd+Alt+T
    tidies a table. The commands *Convert selected lines (CSV) to a table* and *Convert table to CSV
    lines* convert both ways
  - Markdown tables can't merge cells or hold lists or other blocks in a cell
- Command palette (Ctrl/Cmd+P) for every action
- Daily notes (the **Today** button, or Ctrl/Cmd+Shift+D), from a template if you choose one
- Templates: notes in the `Templates` folder, listed in the sidebar's **Templates** tab. Start a
  note from one (it asks for the name and any prompts) or insert one into the open note.
  - Fields: `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`, `{{folder}}`, `{{cursor}}`
    (where typing starts), `{{input:Question}}` and `{{input:Question|default}}` (asked when used)
  - Properties `template-folder` (where new notes go) and `template-name` (e.g.
    `"{{date}} {{input:Topic}}"`) are the template's own settings; other properties, such as
    tags, are copied into the note
  - Starter templates (Meeting, Project, Person, Weekly review, Map of content, Daily) can be added when a
    repository is created, or later from the Templates tab
- Tabs for open files (the button at the end of the tab bar, or the command *Close all tabs*, closes them all), and a side pane to read one note while writing another (the columns
  button in the file tree, or Shift+Enter in the quick switcher)
- Version history for repositories synced with GitHub: see how a note changed and restore an older version
- Export a repository as a zip, and import notes from one (e.g. a zipped Obsidian vault)
- Appearance settings per browser (theme, accent colour, text size, line width), and repository
  settings kept in `.noted/settings.json` (attachment folder, daily notes, templates, SVG
  copies of drawings)
- Drawings also open from the Obsidian Excalidraw plugin's `.excalidraw.md` files; Excalidraw's
  fonts are served by the app itself, not a CDN
- Installable as an app (desktop or phone) that opens offline, with shortcuts on its icon;
  notes are kept in the browser
- Several repositories, with a switcher at the top of the sidebar; both sidebars collapse to
  icon rails
- Sync with GitHub: paste a GitHub token, pick a repository, branch and optional subfolder.
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
   variables are needed; `.env.example` lists the one a later phase adds.
3. Deploy. Every push to `main` deploys to production; other branches get preview URLs.

Check a deployment at `/api/health`, which reports the commit it was built from.

The app is designed for the Hobby plan's limits: pages and `/api/health` are static, and
the only server function planned is a thin Claude proxy for the AI features. See
[docs/PLAN.md § Guiding constraints](docs/PLAN.md#1-guiding-constraints).

## Set up GitHub storage

Nothing needs setting up on the deployment. In the app, go to **Settings →
Repositories & sync → Connect a GitHub repository** and follow the steps: create a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
that can only reach your notes repository, with **Contents: Read and write**, and paste it in.
The browser talks to GitHub directly with it.

- The token is saved in that browser only (IndexedDB), so each device needs it pasted once.
- It can expire (90 days is a good balance). noted-ai reminds you a week ahead, and asks for a
  new one if GitHub stops accepting it; *Edit → Replace token* swaps it any time.
- Keep the token limited to your notes repository: anything that could run inside the app could
  read it.

### How sync works

- The browser talks to `api.github.com` directly with your token; note contents never pass
  through Vercel, and there are no server routes involved.
- Edits are saved in the browser first, so the app works offline. **Automatic** sync commits
  30 seconds (configurable) after you stop typing, when you leave the tab, and when you switch
  repositories; it also checks GitHub for changes when you come back to the tab and every 5 minutes.
  **Manual** sync commits only when you press the sync button.
- All pending edits go up as one commit, e.g. `noted-ai: update Groceries, Plan` (or
  `noted-ai: update 2 files` in an encrypted repository).
- Changes from elsewhere (Obsidian, GitHub's editor, another device) come down on the next sync.
  If the same note changed in both places, edits to different lines are merged. If the same
  lines changed, GitHub's version stays and yours is saved next to it as
  `Note (conflict YYYY-MM-DD).md`. Nothing is overwritten.
- Notes, drawings and other text files (`.md`, `.excalidraw`, `.canvas`, `.json`, `.txt`,
  `.csv`) sync, and so do attachments (images, PDFs, audio, video) as binary files. Hidden
  folders such as `.obsidian/` and other file types are left untouched in the repo.
- Drawings and attachments are never line-merged: if one changed in both places, you get a
  conflict copy.

### Encrypted repositories

When you connect a **new, empty** repository, noted-ai offers to encrypt it end to end. Notes,
attachments and their names are encrypted in the browser before they reach GitHub, so GitHub
(and anyone who gets into your GitHub account) sees only scrambled files under `encrypted/`.

- You choose a passphrase and get a **recovery key**, shown once. Save it: if both are lost,
  the notes can't be recovered by anyone.
- Each device asks for the passphrase (or recovery key) once and keeps the key in the browser.
  *Settings → Repositories & sync → Edit → Forget key* removes it from a device.
- `.noted/encryption.json` holds the encryption settings and the repository key locked with your
  passphrase; it never holds the key itself. A README explains what the repository is.
- Commit messages don't name notes (`noted-ai: update 2 files`). Version history still works.
- Search, links, Connections and canvases work as usual: the browser works on its decrypted copy.
- Encrypted files can't be read on GitHub's website or in Obsidian, and GitHub's diffs show nothing
  useful.
- Repositories that already hold unencrypted notes can't be switched over, because older versions
  stay readable in the git history. To encrypt existing notes, connect a new empty repository with
  encryption on and copy the notes in (with the commands *Export repository as zip* and *Import notes from a zip…*).
- Notes you send to Claude (once the AI features arrive) go through the app's proxy unencrypted;
  encryption protects what's stored on GitHub.

How it works: a random 256-bit repository key, locked with a key derived from your passphrase
(PBKDF2-SHA256, 600,000 iterations). Files and names are encrypted with AES-256-GCM using an IV
derived from an HMAC of the content (a synthetic-IV construction), so the same content always
encrypts to the same bytes. That keeps git's blob ids stable, so sync can still tell what changed
without downloading everything and can fetch old versions for three-way merges. It reveals only
which files are identical, which git shows anyway.

## Layout

```
src/app/            routes (App Router)
src/components/     React components (workspace/ = the editor UI, vault/ = repository state)
src/lib/            framework-free logic with unit tests alongside:
  vault/            repository storage: VaultStore interface, LocalStore (IndexedDB), paths, folder tree
  editor/           CodeMirror setup, formatting commands, live preview
  markdown/         reading-view renderer (unified/remark/rehype), outline
  search/           keyword index (MiniSearch)
  github/           browser GitHub REST client, token storage and checks
  sync/             sync engine (three-way, conflict copies), remote adapter, sync state
  links/            link and tag parsing, Obsidian-style resolution, LinkIndex (backlinks,
                    mentions, graph, rename rewriting)
  drawing/          Excalidraw file parsing (text, links), link rewriting, SVG rendering
tests/e2e/          Playwright tests
docs/PLAN.md        design and roadmap
```
