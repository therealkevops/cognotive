# noted-ai — Plan

A markdown note-taking app in the spirit of Obsidian: wikilinks, backlinks, a graph view,
rich formatting, Excalidraw drawings, and an LLM that can answer questions by exploring the
note graph. Notes live in **a GitHub repository you choose in Settings** (or locally in the
browser). Hosted on **Vercel's free Hobby plan**.

Semantic (embedding) search is deliberately deferred; see [Later](#later-semantic-search).

---

## 1. Guiding constraints

### Vercel Hobby limits that shape the design

| Limit (Hobby) | Value | Design consequence |
|---|---|---|
| Function max duration | 300 s | Each LLM request is **one model turn**, streamed. The tool loop runs in the browser, so no request runs long. |
| Function invocations | 1,000,000 / month | Plenty, as long as GitHub traffic does **not** go through our functions. |
| Active CPU | 4 hours / month | Functions must be thin: token exchange and an LLM proxy only. No indexing or parsing on the server. |
| Fast Origin Transfer | 10 GB / month | Don't proxy note files or images through Vercel. The browser talks to GitHub directly. |
| Fast Data Transfer | 100 GB / month | Static app bundle served from CDN; lazy-load heavy parts (Excalidraw, Mermaid, KaTeX). |
| Function request body | 4.5 MB | Never upload attachments through a function; the browser commits them to GitHub directly. |
| Cron jobs | Once per day | No background workers or queues. Anything periodic happens in the open browser tab. |
| Runtime logs | Kept for 1 hour | Log errors to the browser console; add client-side error reporting later if needed. |
| Usage | Non-commercial only | Fine for personal use. Moving to Pro is a config change, not a redesign. |
| Git integration | Personal-account repos only | `therealkevops/noted-ai` is on a personal account, so auto-deploys work. |

The answer to all of these is the same: **do the work in the browser.** The server is a
small, stateless helper.

### No database in v1

With GitHub as the store, there is nothing the server needs to remember. Notes, drawings,
attachments and vault settings live in the repo; the link graph and search index are built
in the browser and cached in IndexedDB. This removes the hosted database (and its free-tier
limits) entirely until semantic search needs one.

---

## 2. Architecture

```
┌────────────────────────── Browser ──────────────────────────┐
│  Next.js UI (CodeMirror 6, Excalidraw, graph view)          │
│        │                                                    │
│  VaultStore ──┬── LocalStore  (IndexedDB / OPFS)            │
│               └── GitHubStore (REST + Git Data API) ───────────────► api.github.com
│        │                                                    │
│  Indexer (Web Worker): links, tags, headings, MiniSearch    │
│        │                                                    │
│  Agent loop: runs tools locally against the index           │
└────────┼────────────────────────────────────────────────────┘
         │  (one model turn per request, streamed)
┌────────▼──── Vercel Functions (Hobby) ───┐
│ /api/auth/*   GitHub App OAuth + refresh │
│ /api/chat     Claude proxy, SSE stream   │ ─────────────► api.anthropic.com
└──────────────────────────────────────────┘
```

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript, mostly static/client components |
| Editor | CodeMirror 6 with a live-preview mode (markdown stays the source of truth) |
| Markdown | `unified` / `remark`: GFM, frontmatter, wikilinks, callouts, KaTeX, Mermaid |
| Drawings | `@excalidraw/excalidraw`, dynamically imported |
| Search | MiniSearch (keyword, fuzzy, prefix) in a Web Worker |
| Graph view | `react-force-graph` (or Sigma.js if it needs to scale further) |
| Local cache | IndexedDB via `idb`: file contents keyed by Git blob SHA, plus the index |
| Auth | GitHub App (user-to-server tokens) — this is also the login |
| LLM | Claude API (`@anthropic-ai/sdk`, `claude-opus-5-5`), tool use, streaming |
| Tests | Vitest (parsers, indexer, sync), Playwright (editor flows) |

---

## 3. GitHub as the document store

### Settings
**Settings → Vaults** holds a list of vaults; a vault switcher in the sidebar moves between
them. Each vault has its own cache and index in IndexedDB (namespaced by vault ID), so
switching is instant after the first load. For each vault the user picks:

- **Name**
- **Backend:** `Local (this browser)` or `GitHub repository`
- **Repository:** chosen from the repos the GitHub App was installed on
- **Branch:** default `main`
- **Vault folder:** optional subfolder, so a vault can live inside a larger repo
- **Sync mode:** **auto by default** (commit after an idle period, on tab blur, and on
  switching vaults), or manual ("Sync" button only). The idle interval is configurable
  (default 30 s).
- **Commit message template:** e.g. `notes: update {files}`

App-wide preferences (theme, editor mode) live in `localStorage`. Vault-level settings
(attachment folder, daily-note format, ignored paths) live in the repo at
`.noted/settings.json` so they follow the vault across devices.

### Why a GitHub App (not a classic OAuth App or a pasted token)
- Fine-grained: the user grants access to specific repositories only, with
  `Contents: read & write` and `Metadata: read`.
- Short-lived user tokens (8 h) with a refresh token.
- Doubles as login, so there's no separate auth provider.

**Token handling:** the client secret stays on the server. `/api/auth/callback` exchanges
the code and stores the **refresh token in an encrypted, httpOnly cookie**. The browser
asks `/api/auth/token` for a short-lived access token, keeps it in memory, and calls
`api.github.com` directly (GitHub's API supports CORS). That keeps GitHub traffic off
Vercel's invocation and transfer budgets.

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
  If the merge has conflicts, keep both: the remote version stays, and ours is saved as
  `Note (conflict 2026-11-14).md` with a banner in the UI.
- **Rate limits:** 5,000 requests/hour per user is far more than this needs; the client
  backs off on `403`/`429` and shows sync status.
- **Offline:** works naturally. Edits stay in IndexedDB and are committed when back online.

### Private-repo images
Images in a private repo can't be loaded by URL in `<img>`. The client fetches the blob
through the API and renders it as an object URL, cached by SHA.

---

## 4. Knowledge graph (no embeddings yet)

Built in a Web Worker from the cached markdown, updated incrementally on each save:

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

A chat side panel. Claude answers questions by calling tools that run **in the browser**
against the local index:

| Tool | Purpose |
|---|---|
| `search_notes(query, limit)` | Keyword search (MiniSearch), returns snippets |
| `get_note(path)` | Full markdown of a note |
| `get_links(path, direction)` | Outgoing links, backlinks, or both |
| `traverse(path, depth, filter)` | Walk the graph N hops from a note |
| `find_by_tag(tag)` / `find_by_property(key, value)` | Structured queries |
| `list_folder(path)` | Browse the vault |
| *(later)* `create_note`, `append_to_note`, `add_link` | Write tools; each change shown as a diff to accept |

**Flow:** the browser sends the conversation to `/api/chat`; the function makes **one**
streamed Messages API call and relays it. If Claude asks for tools, the browser runs them,
appends the results, and sends the next turn. Each invocation is short, so the 300 s limit
and the 4-hour CPU budget aren't a concern (streaming time spent waiting on the network
uses very little active CPU).

**Answers cite notes**, and each citation opens the note.

**API key:** stored as a Vercel environment variable. `/api/chat` only serves logged-in
users on an allowlist of GitHub user IDs (for now, just the owner), so nobody else can
spend the key. "Bring your own key" is a future decision, to revisit if other people use the
app; `/api/chat` takes the key from one place so adding it later is a small change.

**Context size:** notes go to the model only when a tool asks for them; long notes are
returned by section rather than whole.

---

## 6. Formatting and editor features

- Toolbar + shortcuts: bold, italic, strikethrough, highlight, headings, lists, task lists,
  quotes, inline code, code blocks, links, tables (with a table editor), horizontal rules.
- Live preview (hide syntax away from the cursor) and source mode; reading view.
- Code blocks with syntax highlighting; KaTeX math; Mermaid diagrams; callouts (`> [!note]`).
- Paste or drop images → committed to `attachments/` and linked.
- `[[` autocomplete, hover previews, Ctrl/Cmd-click to open or create.
- Quick switcher (Ctrl/Cmd+O), command palette (Ctrl/Cmd+P), tabs, split panes.
- Daily notes and templates (later in phase 1 or 2).

### Excalidraw
- Drawings are `.excalidraw` JSON files in the repo, edited full screen.
- Embed in a note with `![[Architecture.excalidraw]]`; rendered as an SVG preview.
- Elements can link to notes (`[[Note]]` in the element's link), feeding the graph.
- The Excalidraw bundle (~1 MB) loads only when a drawing is opened or embedded.

---

## 7. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Scaffold** | Next.js + TS, Tailwind, ESLint, Vitest, Playwright, GitHub Actions CI, Vercel project linked | A hello-world deploys from `main` and CI is green |
| **1. Local editor** | `VaultStore` interface + `LocalStore`; file tree; CodeMirror with live preview and all formatting; quick switcher; keyword search | You can write and organise notes entirely in the browser |
| **2. GitHub store** | GitHub App, login, Settings → Vaults (multiple vaults, switcher), `GitHubStore`, sync engine with batching, pull, conflicts, offline; attachments | Edits made in the app show up as commits; edits pushed from Obsidian show up in the app |
| **3. Linking** | Wikilinks, autocomplete, backlinks, unlinked mentions, tags, frontmatter, rename refactor, graph views | The graph matches what Obsidian shows for the same vault |
| **4. Excalidraw** | Drawing files, embeds, SVG previews, links from drawings | Drawings round-trip through the repo and appear in the graph |
| **5. LLM** | `/api/chat` proxy, browser-side tool loop, chat panel, citations, allowlist | You can ask "what have I written about X and how does it connect to Y?" |
| **6. Polish** | Command palette, themes, mobile layout, templates, daily notes, write tools for the LLM | — |

Each phase ends deployed to Vercel and usable.

---

## Later: semantic search

When it's time, two options that both stay within free tiers:

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
- **Privacy:** notes sent to the LLM go to Anthropic. The chat panel should make clear
  which notes were read.
- **Hobby is non-commercial:** if this becomes a product, move to Pro.

## Decisions
- **Multiple vaults:** yes. One account can add several vaults (repos or local) and switch
  between them.
- **Sync:** auto-commit by default; mode and idle interval are configurable per vault.
- **Bring your own Anthropic key:** deferred. The app is single-user for now.
