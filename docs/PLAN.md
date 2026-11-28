# Cognotive.ai — Plan

A markdown note-taking app in the spirit of Obsidian: wikilinks, backlinks, a graph view,
rich formatting, Excalidraw drawings, and an LLM that can answer questions by exploring the
note graph. Notes live in **a GitHub repository you choose in Settings** (or locally in the
browser). Hosted on **Vercel's free Hobby plan**.

Everything runs in the browser: there are no server routes apart from a static `/api/health`.
AI features are described in [AI_PLAN.md](AI_PLAN.md).

---

> **Terminology:** the app calls a set of notes a **repository** (Obsidian's "vault"). This
> document and the code still say "vault" in places; they mean the same thing.

## 1. Guiding constraints

### Vercel Hobby limits that shape the design

| Limit (Hobby) | Value | Design consequence |
|---|---|---|
| Functions (duration, invocations, CPU, request body) | 300 s, 1M / month, 4 h / month, 4.5 MB | The app uses none: GitHub and AI providers are called straight from the browser. |
| Fast Origin Transfer | 10 GB / month | Don't proxy note files or images through Vercel. The browser talks to GitHub directly. |
| Fast Data Transfer | 100 GB / month | Static app bundle served from CDN; lazy-load heavy parts (Excalidraw, Mermaid, KaTeX, React Flow, the search model). |
| Deployments | Each one is kept | `vercel.json` deploys `main` only, so branches don't add a copy each. |
| Cron jobs | Once per day | No background workers or queues. Anything periodic happens in the open browser tab. |
| Runtime logs | Kept for 1 hour | Log errors to the browser console; add client-side error reporting later if needed. |
| Usage | Non-commercial only | Fine for personal use. Moving to Pro is a config change, not a redesign. |
| Git integration | Personal-account repos only | `therealkevops/noted-ai` is on a personal account, so auto-deploys work. |

The answer to all of these is the same: **do the work in the browser.** Vercel only serves
static files.

### No database in v1

With GitHub as the store, there is nothing the server needs to remember. Notes, drawings,
attachments and vault settings live in the repo; the link graph and search index are built
in the browser and cached in IndexedDB. Search by meaning runs in the browser too (see
[Semantic search](#semantic-search)), so there is no hosted database.

---

## 2. Architecture

```
┌────────────────────────── Browser ──────────────────────────┐
│  Next.js UI (CodeMirror 6, Excalidraw, graph view)          │
│        │                                                    │
│  VaultStore ── LocalStore (IndexedDB), one per repository   │
│        │                                                    │
│  Sync engine ── GitHub remote (REST + Git Data API) ────────────► api.github.com
│        │        (optionally wrapped by EncryptedRemote)     │
│  Indexes: links, tags, properties, MiniSearch;              │
│           embeddings in a Web Worker (opt-in)               │
│        │                                                    │
│  Agent loop: runs tools locally against the indexes ────────────► OpenRouter / local / custom
└─────────────────────────────────────────────────────────────┘
   Vercel serves the static app only (plus a static /api/health).
```

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript, mostly static/client components |
| Editor | CodeMirror 6 with a live-preview mode (markdown stays the source of truth) |
| Markdown | `unified` / `remark`: GFM, frontmatter, wikilinks, callouts, KaTeX, Mermaid |
| Drawings | `@excalidraw/excalidraw`, dynamically imported |
| Canvas | React Flow (`@xyflow/react`), JSON Canvas files, dynamically imported |
| Search | MiniSearch (keyword, fuzzy, prefix); embeddings via transformers.js in a Web Worker |
| Graph view | A small deterministic force layout (`src/lib/links/graph-layout.ts`) drawn as SVG |
| Local cache | IndexedDB via `idb`: file contents and entries per repository, sync state |
| Auth | A fine-grained GitHub token per repository, kept in IndexedDB on the device |
| LLM | Any OpenAI-compatible endpoint from the browser; see [AI_PLAN.md](AI_PLAN.md) |
| Tests | Vitest (parsers, indexer, sync), Playwright (editor flows) |

---

## 3. GitHub as the document store

### Settings
**Settings → Vaults** holds a list of vaults; a vault switcher in the sidebar moves between
them. Each vault has its own cache and index in IndexedDB (namespaced by vault ID), so
switching is instant after the first load. For each vault the user picks:

- **Name**
- **Backend:** `Local (this browser)` or `GitHub repository`
- **Repository:** chosen from the repos the token can write to
- **Branch:** default `main`
- **Vault folder:** optional subfolder, so a vault can live inside a larger repo
- **Sync mode:** **auto by default** (commit after an idle period, on tab blur, and on
  switching vaults), or manual ("Sync" button only). The idle interval is configurable
  (default 30 s).
- **Commit message template:** e.g. `notes: update {files}`

App-wide preferences (theme, editor mode) live in `localStorage`. Vault-level settings
(attachment folder, daily-note format, ignored paths) live in the repo at
`.noted/settings.json` so they follow the vault across devices.

### Connecting
Repositories connect with a **fine-grained personal access token** limited to the notes
repository (Contents: read & write), pasted once per device and stored in IndexedDB
(`noted-ai:tokens`). The browser calls `api.github.com` directly (it supports CORS), so no server
routes or environment variables are involved. The token is readable by code running in the page,
so the instructions keep it to one repository and an expiry; the app warns a week before expiry
and asks for a new token on a 401. (An earlier GitHub App sign-in, with server routes for the
token exchange, was removed.)

### Repository layout (also a valid Obsidian vault)
```
<vault folder>/
  Some Note.md
  Projects/Project X.md
  Drawings/Architecture.excalidraw
  attachments/diagram.png
  .noted/settings.json
```
`.obsidian/` is ignored, so the same repo can be opened in Obsidian.

### Sync engine
- **First load:** one call to the Git Trees API (`recursive=1`) lists every file with its
  SHA. Markdown is fetched (small, needed for the index); attachments are fetched on demand.
  Everything is cached in IndexedDB by blob SHA, so later loads only fetch changed files.
- **Editing:** every keystroke saves to IndexedDB immediately. The note is marked dirty.
- **Committing:** in auto mode, after the configured idle period (default 30 s), on tab blur,
  or on switching vaults; in either mode, on "Sync". All dirty
  files go into **one commit** via the Git Data API (create blobs → tree → commit →
  update ref). This avoids a commit per keystroke and keeps history readable.
- **Pulling:** check the branch head on focus and every few minutes with a conditional
  request (`If-None-Match`); a `304` doesn't count against the rate limit. If the head moved,
  diff the trees and fetch only changed files.
- **Conflicts:** if the ref update is rejected (someone pushed from Obsidian or another
  device), fetch the remote version and run a three-way merge against the last synced base.
  If the merge has conflicts, the note keeps every change that merged and the remote's lines
  where both sides changed; ours is kept on the device as a conflict record, and a banner on
  the note opens a side-by-side review (keep theirs, ours or both for each clash). Non-text
  files offer theirs, ours, or both (ours as a copy).
- **Rate limits:** 5,000 requests/hour per user is far more than this needs; the client
  backs off on `403`/`429` and shows sync status.
- **Offline:** works naturally. Edits stay in IndexedDB and are committed when back online.
- **Cheap repeat syncs:** the sync state remembers each local file's id by modification time
  and the remote's file list by tree, so a sync where little changed reads and hashes only the
  changed files and skips listing an unchanged branch. A remembered id is checked against the
  file before it's acted on.
- **Several tabs or windows:** the store reports each saved change and other tabs re-read those
  files (BroadcastChannel). A save that finds the file changed since it was loaded merges the
  two (or keeps the other version as a "(from another window)" copy), and a Web Lock lets only
  one tab sync at a time.
- **Listing is cheap:** the local store keeps each file's path and time in an `entries` store,
  so listing the repository never reads note text or attachment bytes.
- **Failures are contained:** error boundaries around the sidebar, panel, note view, side pane
  and dialogs replace a crashed part with a message and Try again.

### End-to-end encryption (optional, per repository)
Offered when connecting an empty repository. `EncryptedRemote` wraps the GitHub remote, so the
sync engine is unchanged apart from asking the remote for a content id (`contentId`) instead of
hashing plaintext itself:
- Files are stored at `encrypted/<base32 of the encrypted path>` (long names split into folders
  of 200 characters) with AES-256-GCM content. The IV is an HMAC of the plaintext, so encryption
  is deterministic and git blob ids stay meaningful for change detection and three-way merges.
- A random repository key is wrapped with a PBKDF2 passphrase key in `.noted/encryption.json`;
  the recovery key is the repository key itself. Devices keep non-extractable working keys in
  IndexedDB (`noted-ai:keys`).
- Commit messages are neutral. A plain remote refuses to sync a repository that has
  `.noted/encryption.json`, so nothing is pushed there unencrypted.
- Not yet: changing the passphrase, and encrypting an existing repository in place (its history
  would stay readable).

### Private-repo images
Images in a private repo can't be loaded by URL in `<img>`. The client fetches the blob
through the API and renders it as an object URL, cached by SHA.

---

## 4. Knowledge graph

Built in the browser from the cached markdown, updated incrementally on each save:

- **Links:** `[[Note]]`, `[[Note#Heading]]`, `[[Note#^block]]`, `[[Note|alias]]`,
  `![[embed]]`, and standard markdown links.
- **Tags:** inline `#tag`, nested `#area/sub`, and frontmatter `tags:`.
- **Frontmatter:** arbitrary properties, queryable (e.g. `status: active`).
- **Derived:** backlinks, unresolved links, unlinked mentions (text matching another
  note's title or alias), orphans.
- **Drawings:** text and note links inside `.excalidraw` files become graph edges too.
- **Rename refactoring:** renaming or moving a note rewrites every link to it, in one commit.

Views: backlinks pane, outgoing links, tag pane, a global graph, and a local graph
(the current note within N hops) with filters by tag and folder.

---

## 5. Querying with the LLM

Described in [AI_PLAN.md](AI_PLAN.md): models are called from the browser through OpenRouter, a
local server (Ollama, LM Studio) or any OpenAI-compatible endpoint, with the user's own key on the
device. The agent's tools run in the browser against the local indexes, answers cite the notes
they read, and changes are proposals the user reviews.

---

## 6. Formatting and editor features

- Toolbar + shortcuts: bold, italic, strikethrough, highlight, headings, lists, task lists,
  quotes, inline code, code blocks, links, tables (with a table editor), horizontal rules.
- Live preview (hide syntax away from the cursor) and source mode; reading view.
- Code blocks with syntax highlighting; KaTeX math; Mermaid diagrams; callouts (`> [!note]`).
- Paste or drop images → committed to `attachments/` and linked.
- `[[` autocomplete, hover previews, Ctrl/Cmd-click to open or create.
- Quick switcher (Ctrl/Cmd+O), command palette (Ctrl/Cmd+P), tabs, split panes.
- Daily notes and templates.

### Excalidraw
- Drawings are `.excalidraw` JSON files in the repo, edited full screen.
- Embed in a note with `![[Architecture.excalidraw]]`; rendered as an SVG preview.
- Elements can link to notes (`[[Note]]` in the element's link), feeding the graph.
- The Excalidraw bundle (~1 MB) loads only when a drawing is opened or embedded.

### Canvas
- Boards are `.canvas` files in [JSON Canvas](https://jsoncanvas.org) format, the same as Obsidian's,
  so they open in either app. Unknown fields are kept when saving.
- Cards: text (markdown, `[[links]]` work), notes (rendered, a heading or block via `subpath`),
  images and drawings, other files, web links, and groups. Arrows join card sides and can carry a
  label and colour.
- File cards and links in text cards count as links (backlinks, graph, renames update them).
- Labelled arrows between note cards are typed relations (`canvasRelations` in the link index),
  shown on each note's Links panel as "Canvas connections", and ready for the LLM to query.
- Built on React Flow, loaded only when a canvas is opened.

---

## 7. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Scaffold** ✅ | Next.js + TS, Tailwind, ESLint, Vitest, Playwright, GitHub Actions CI, Vercel project linked | A hello-world deploys from `main` and CI is green |
| **1. Local editor** ✅ | `VaultStore` interface + `LocalStore`; file tree; CodeMirror with live preview and all formatting; quick switcher; keyword search | You can write and organise notes entirely in the browser |
| **2. GitHub store** ✅ (text files) | Token connection, Settings → Vaults (multiple vaults, switcher), `GitHubStore`, sync engine with batching, pull, conflicts, offline; attachments | Edits made in the app show up as commits; edits pushed from Obsidian show up in the app |
| **3. Linking** ✅ | Wikilinks, autocomplete, backlinks, unlinked mentions, tags, frontmatter, rename refactor, graph views | The graph matches what Obsidian shows for the same vault |
| **4. Excalidraw** ✅ (with attachments) | Drawing files, embeds, SVG previews, links from drawings | Drawings round-trip through the repo and appear in the graph |
| **5. LLM** ✅ | See [AI_PLAN.md](AI_PLAN.md): phases A–E (providers and chat, read agent, write proposals, agent actions, bridge and MCP) | You can ask "what have I written about X and how does it connect to Y?", and the agent can propose changes |
| **6. Polish** ✅ | Command palette, themes, mobile layout, templates, daily notes, tabs, side pane, version history, zip import/export, installable offline app | — |

Each phase ends deployed to Vercel and usable.

**Phase 6 closed every item carried over from phases 1–4**, except:

- **Editing in the side pane.** The side pane is read-only (reading view), for referring to a
  note while writing another; a second live editor is a larger change.
- **Indexing in a Web Worker.** Not needed yet: indexing is fast for personal vaults, and first
  syncs now download files in parallel. Revisit if a vault reaches thousands of notes.

---

## Semantic search

**Done (option 1):** `src/lib/semantic/` chunks notes by heading and paragraph, embeds the passages
with BGE small (8-bit) through transformers.js in a Web Worker, keeps the vectors in IndexedDB per
repository (re-embedding only changed notes), and searches them by brute force. Results are merged
with keyword search by reciprocal rank fusion. The model and the ONNX runtime are copied into
`public/` at build time (`scripts/fetch-semantic-assets.mjs`) so nothing loads from a CDN. It's
opt-in per device (Settings → Search). Vectors aren't committed to the repository yet: each device
indexes its own copy.

The options that were considered:

1. **In the browser:** a small embedding model via `transformers.js`; vectors cached in
   IndexedDB and optionally committed to `.noted/embeddings/` so other devices don't
   recompute them. No server, no cost, but slower on first index.
2. **Hosted:** Postgres with `pgvector` (Neon or Supabase free tier) plus an embeddings
   API. Faster and works across devices, but adds a database and another provider.

Either plugs into the same `search_notes` tool, merged with keyword results.

---

## Risks

- **GitHub as a database:** commits are not instant (a few hundred ms) and history grows
  with every sync. Batching and the idle delay keep this manageable.
- **Large vaults:** first load of thousands of notes is many requests. Mitigation: cache by
  SHA, fetch in parallel with a concurrency cap, and show the UI before indexing finishes.
- **Privacy:** notes the agent reads go to the chosen AI provider. The chat panel lists which
  notes were read, and an encrypted repository defaults to a local model.
- **Hobby is non-commercial:** if this becomes a product, move to Pro.

## Decisions
- **Multiple vaults:** yes. One account can add several vaults (repos or local) and switch
  between them.
- **Sync:** auto-commit by default; mode and idle interval are configurable per vault.
- **AI keys:** each user brings their own, kept on the device (`src/lib/ai/keys.ts`).
