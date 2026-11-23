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
- In live preview, properties show as a panel: tags and aliases as chips, `hub` as a checkbox you
  can tick, empty values marked. Click a row to edit its YAML (with the suggestions below);
  **+ Add property**, or the command *Add a property* (which also starts a block in a note without
  one), offers property names straight away. Notes with properties open with the cursor below them
- In the reading view (and the side pane, and from a note card on a canvas: the sliders button),
  properties can be edited in place: add or remove tags and aliases (tags
  suggested from the repository), tick `hub`, pick dates from a calendar, type other values (with
  values used before suggested), remove a property, or **+ Add property** (names suggested, with
  what each does). Changes are written into the note's YAML
- Drawings have properties too (the sliders button among the drawing's tools): kept in the
  frontmatter of the Obsidian plugin's `.excalidraw.md` files (its own `excalidraw-…` keys are left
  alone), and under a `properties` key in plain `.excalidraw` files, which Excalidraw ignores. A
  drawing's tags and aliases count like a note's
- Attachments (images, PDFs, audio, video) have properties too, edited above the file. They're
  kept in `.noted/properties.json` (by path; it syncs, and follows renames, moves and deletes), and
  their tags and aliases count like a note's
- Managing properties: the sidebar's **Properties** tab lists every property with how many files
  use it and its common values; rename or delete one everywhere, give your own properties a type
  (text, list, number, date, checkbox: kept in `.noted/settings.json`), or click a value to find
  the files. Search finds files by property with `[status]` or `[status:draft]`, alone or with
  words. Canvases have properties too (the sliders button in the canvas toolbar)
- Editing many files' properties at once: **Edit properties** on search results (or *Edit as
  table* in the Properties tab) opens a table with a row per file and a column per property. Edit
  any cell (lists as `a, b`; an empty cell removes the property), add a column, or set or remove a
  property for every file. The side pane also edits the properties of drawings and canvases
- Help with properties, as in a code editor: in the properties block, names are suggested as you
  type (with what each one does), then values: your tags, `true`/`false` for `hub`, today's date
  for `created`/`reviewed`, and values you've used before for your own properties. Hovering over a
  name explains it, and mistakes are underlined (a name listed twice, invalid YAML, `hub: maybe`,
  a date that isn't YYYY-MM-DD, tags with spaces, a block with no closing `---`)
- Properties for new notes (Settings → This repository): tick the ones every new note starts with
  (`created` with today's date, `tags`, `aliases`, `hub`, `reviewed`) and add your own (e.g.
  `status`). Notes from templates keep the template's values; templates themselves are left alone
- Repository health: a score out of 100 with totals and a heatmap of recent changes; a link map
  of the whole repository (hubs large, orphans loose, missing notes as dashed stubs, hubs waiting to be written as dashed orange
  rings, pinned hubs haloed and always named; hover to see a
  note's links, click to open it or create a missing one); and cards for broken links, orphans,
  dead ends, hubs and stale hubs (well-linked notes not changed or reviewed in six months; **Mark
  reviewed** records `reviewed: YYYY-MM-DD` in the note) that open lists to act on. Hubs are notes well above average in
  links in, index notes linking out to many, and notes pinned with `hub: true` (with the command
  *Pin this note to the sidebar as a hub*, or **Pin** in the Hubs list; `hub: false` opts a note
  out). Pinned hubs are listed at the top of the sidebar's Files tab, with hubs waiting to be written listed under
  *To write* (creating one offers to pin it). The Connections panel shows which pinned hubs the open note is in
  and, if none, suggests up to three it mentions or shares tags or links with (**Add** lists it in
  the hub's Notes section, or at the end); Repository health suggests a hub for orphans too; missing notes linked from three or more
  notes are listed as hubs waiting to be written. Quick fixes: create a missing note,
  link an orphan from a note that mentions it, link a dead end to a note it mentions, or ignore a
  note (kept in `.noted/settings.json`); the score updates as you go, with a count of what you fixed
  today
- Canvases (`.canvas`, the JSON Canvas format Obsidian uses): cards for text, notes, images,
  drawings and web links, groups, and labelled arrows, which become typed relations. A canvas
  file that isn't valid JSON opens with an explanation and *Edit as text*, rather than an empty board
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
- **Live queries**: a code block that lists the notes (or tasks) matching a query, kept up to date
  in reading view and live preview (click a result to open it; click elsewhere in the block to edit
  the query). *Insert a live query* in the palette starts one. The app's search syntax plus options:

  ````markdown
  ```query
  #project [status:active] garden
  show: table status, owner, due     (or: list, tasks, done tasks, all tasks)
  sort: due desc
  limit: 20
  from: Projects                     (a folder, or "Folder", #tag, [[Note]])
  where: due < date(today) and owner = "Ann"
  ```
  ````

  Obsidian's **Dataview** blocks work too, for the common part of its language: `LIST`, `TABLE a, b
  AS "B"`, `TASK`, `FROM #tag / "Folder" / [[Note]] / outgoing([[Note]])` with `and`, `or`, `-`,
  `WHERE` conditions (`=`, `!=`, `<`, `>`, `and`, `or`, `!`, `contains()`, `length()`, `date(today)`),
  `SORT` and `LIMIT`. Fields are properties plus `file.name`, `file.folder`, `file.mtime`,
  `file.tags`, `file.inlinks` and `file.outlinks`. DataviewJS isn't run, and `GROUP BY` and
  `CALENDAR` aren't supported yet (a block says so in place)
- **Keeping notes safe in the browser**: the app asks the browser to keep its storage permanently
  (Settings → Repositories & sync shows whether it agreed, and how much space notes use).
  Repositories kept only in this browser get a reminder to export a backup or connect GitHub when
  they've changed since the last backup two weeks ago, and straight away in Safari when not
  installed, since Safari may clear a site's data after a week without a visit
- **Quick capture**: jot something down without opening a note. *Quick capture* in the sidebar, the
  command palette, or the installed app's icon (long-press, *Quick note*) opens a box for text and
  photos or files; it's added to **today's daily note** (or an **inbox** note, in Settings → This
  repository) under a *Captured* heading, as a list item with the time. **Share to noted-ai** from
  other apps puts links, text and pictures in the same box to review first: links become
  `[title](url)`, pictures are saved as attachments and embedded. Sharing into the app works where
  the browser supports it (Android, and Chrome or Edge on desktop), but not on iPhone or iPad, where
  the icon shortcut still does. It works offline; captures sync with the rest
- **Search by meaning** (Settings → Search, per device, off until turned on): finds notes that mean
  what you searched for even when the words differ ("how often should I water" finds "irrigate the
  beds every Tuesday"), merged with the usual word matches and marked *by meaning*. Connections lists
  unlinked notes that are **similar in meaning**, and the AI agent's search uses it too. A small model
  (BGE small, about 48 MB with its runtime, downloaded once from this app, not a CDN) runs in a
  background worker in the browser; notes never leave it. Each note is indexed in passages once, and
  again only when it changes
- **Tasks** (the checklist tab in the left sidebar, or *Show tasks*): every `- [ ]` in every note,
  grouped by due date (Overdue, Today, Tomorrow, Next 7 days, Later, No date) or by note, with
  Open / Done / All and a filter for words, `#tags` or note names. Tick a task to tick it in its note;
  click it to open the note at that line. Dates and priorities are read the way Obsidian's Tasks and
  Dataview plugins write them (`📅 2026-12-01`, `[due:: 2026-12-01]`, `⏳` scheduled, `⏫ 🔼 🔽`),
  (the app reads these markers but never writes emoji itself). The AI agent can list tasks too
  ("what's due this week?"), and the weekly review mentions overdue ones
- **The `/` menu**: type `/` at the start of a line or after a space for commands, in sections:
  - *Blocks*: `/h1`–`/h3`, `/callout tip` (note, tip, warning, question…), `/quote`,
    `/code python`, `/table 3x4` (columns × rows, edited as a grid), `/math`, `/diagram`
    (Mermaid), `/query` (a live query) and `/divider`
  - *Insert*: `/link` and `/embed` (start a link and suggest notes), `/attach` (files, or a photo
    from a phone's camera, embedded where you type), `/drawing` (a new drawing, embedded),
    `/template` and `/property`
  - *Tasks and dates*: `/task`, `/priority high` (writes `[priority:: high]`), and `/due`,
    `/scheduled`, `/start`, which take a date in words (`/due this tue`, `/due next friday`,
    `/due in 3 days`, `/due 24 nov`, `/due end of month`) and show the date it means before writing
    `[due:: 2026-11-24]`; `/date` inserts a plain date and `/daily this fri` links that day's
    daily note. "next tue" means Tuesday of next week. In live preview task fields read as
    "Due Tue 24 Nov" and "High priority". A slash in "24/11" or "and/or" is left alone
  - *AI* (once AI is set up in Settings): `/ask` asks about the paragraph you're in (type a
    question after it, `/ask what does this mean`, or pick a quick one), `/summarise`, `/links`
    (suggest links), `/tags` (suggest tags and properties) and `/review` (your week). Changes the AI
    proposes still wait for you to apply them
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
  notes are kept in the browser. After a new version is deployed, a page opened before it reloads
  itself the first time it needs a part of the app it hasn't loaded yet (the canvas or drawing editor)
- Several repositories, with a switcher at the top of the sidebar; both sidebars collapse to
  icon rails
- Sync with GitHub: paste a GitHub token, pick a repository, branch and optional subfolder.
  Notes sync both ways; see [How sync works](#how-sync-works)
- AI chat about your notes, in the **Chat** tab of the right panel (see
  [How the AI agent works](#how-the-ai-agent-works)). The model searches and reads
  notes by itself (search, read a note or a section, follow links and backlinks, hubs, tags,
  properties, folders, repository health), cites them as `[[links]]`, and each answer lists every
  note it read and every step it took. Models that can't use tools (many small local ones) are given
  the notes that best match the question instead. The agent can be turned off, and the steps per
  question limited, in **Settings → AI**.
  - **Proposed changes:** asked to, the agent proposes new notes, additions (at the end or under a
    heading), edits, properties and links. Each shows as a diff under the answer, to **Apply**,
    **Edit** first, or **Reject** (or **Apply all**); nothing changes until you apply it. A change is
    merged onto edits made since it was proposed, and refused if they touch the same lines. Turn
    proposals off for a read-only agent
  - **Agent actions**, where they belong (and in the command palette as *AI: …*); each runs in the
    chat and comes back as proposals to review:
    - *Summarise this note* (and propose a `summary` property)
    - *Suggest links* (Connections panel): links where notes mention each other or are related
    - *Suggest tags and properties* (Properties panel), in the repository's own vocabulary
    - *Write with AI* for a hub waiting to be written (Repository health, and Hubs → To write)
    - *Find homes with AI* for orphans, and *Review with AI* for stale hubs (Repository health)
    - *Fill empty with AI* for a column of the property table
    - *What did I work on this week?* (the empty chat, or the palette), from recently changed notes
  - **Save as note** keeps a chat in the `AI/` folder (set in **Settings → AI**), with its sources
  - **Ask** about a selection (Ctrl/Cmd+Shift+Enter, or *Ask AI about the selection…*): the answer
    can be saved as a note that the selection then links to, inserted below, or copied

  Set it up in **Settings → AI**:
  - **Claude plan**: your Claude subscription, through Claude Code on your computer and the
    noted-ai bridge (see [The companion](#the-companion-claude-plan-and-mcp)). No API key
  - **OpenRouter** (one key, hundreds of models): the key is checked and shows its spend limit, and
    the model list is searchable, with prices and which models can use tools
  - **Local**: Ollama (`http://localhost:11434/v1`) or LM Studio (`http://localhost:1234/v1`), with a
    connection check that explains what's wrong (not running, no models, or the server not allowing
    this site: start Ollama with `OLLAMA_ORIGINS="https://your-app.example" ollama serve`)
  - **Custom**: any OpenAI-compatible endpoint, with an optional key
  - Requests go straight from the browser to the provider; keys stay on the device (or only for the
    session) and never go into the repository. Answers stream in, can be stopped (Esc) and retried,
    and their `[[links]]` open notes. The open note goes with a question unless you click its chip off
  - A repository can be kept to local models only (**Settings → AI → This repository**); encrypted
    repositories are, unless you allow remote providers

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

## How the AI agent works

The AI in noted-ai doesn't just answer from the note in front of it. It looks things up across your
notes by itself, shows exactly what it read, and **proposes** changes rather than making them.

### How a question is answered

When you ask something in the **Chat** tab, a loop runs in your browser:

1. **Ask:** your question goes to the model, along with the open note (while its chip is on) and
   a list of tools it may use.
2. **Look things up:** the model asks for a tool, such as "search notes for *garden*". The app
   runs it against your notes in the browser and sends back the result. Nothing is uploaded unless
   the model asks for it.
3. **Repeat:** it might read a note, follow its backlinks, or check a hub, until it has enough.
   A step limit (12 by default, set in **Settings → AI**) stops it looking forever.
4. **Answer:** it replies citing notes as `[[links]]`, which open the note.

While it works you see each step (*Searched “garden”…*, *Read Compost*). Afterwards, **Read N
notes** lists every step and every note whose text was sent to the model.

### What it can look at

- **Search:** keyword search, including `tag:x` and `[status:draft]` filters, and search by meaning
  when it's on.
- **Read:** a whole note, or one heading's section, with its properties.
- **Connections:** links, backlinks, unlinked mentions, related notes and notes similar in meaning,
  plus labelled canvas arrows.
- **Nearby notes:** everything within a few links of a note.
- **Structure:** hubs (and which hub a note belongs in), tags, properties and folders.
- **Tasks:** open or done tasks across notes, by due date, words or tags.
- **Health:** the repository health report (orphans, broken links, stale hubs).

These use the same indexes the app already keeps for search, the link panels and Repository health.

### Changes are proposals

When asked, the model can suggest:

- new notes
- additions at the end of a note or under a heading
- edits
- property changes
- links: turning a mention into a link, or adding a note to a hub

Each suggestion appears under the answer as a **before/after diff**. You can **Apply**, **Edit**
first, **Reject**, or **Apply all**. **Nothing is written until you apply it.** If you've edited the
note since the suggestion was made, applying it merges the change onto your current text; if you
both changed the same lines, it refuses and says why.

### Ready-made actions

These are ready-made jobs, placed where they're useful. Each runs in the chat and comes back as
proposals for you to review.

| Action | Where |
|---|---|
| Summarise this note (and propose a `summary:` property) | Command palette, empty chat |
| Suggest links | Connections panel |
| Suggest tags and properties, reusing names you already use | Properties panel |
| Write a hub that many notes link to but doesn't exist yet | Repository health, Hubs → To write |
| Find homes for orphan notes | Repository health |
| Review stale hubs, then mark them reviewed | Repository health |
| Fill a property for files that don't have it | Property table |
| What did I work on this week? | Empty chat, command palette |

### Ask and Save as note

- **Ask:** select text and press **Ctrl/Cmd+Shift+Enter**. You can save the answer as a new note
  that your selection then links to, insert it below the selection, or copy it.
- **Save as note:** stores the whole conversation, with its sources, in an `AI/` folder (you can
  change the folder in **Settings → AI**).

### Which model answers

Set this in **Settings → AI**:

- **OpenRouter:** one key, hundreds of models, including free ones. It's the recommended option.
- **Local:** Ollama or LM Studio. Your notes never leave your machine.
- **Claude plan:** your Claude subscription, through Claude Code on your computer, using
  [the companion](#the-companion-claude-plan-and-mcp) bridge.
- **Custom:** any endpoint that works like OpenAI's API.

Requests go straight from your browser to the provider, and keys stay on your device. Some models
can't use tools, and many small local ones can't. For those, the app picks the notes that best match
your question and sends them instead, and labels the answer *answered from search results*.

### Your controls

- **Repository privacy:** you can keep a repository to local models only. Encrypted repositories are
  local-only by default.
- **Agent on or off:** turn the agent off and the model only sees the open note.
- **Proposals on or off:** turn proposals off and the agent only reads.
- **Visibility:** each answer shows the notes it read and the tokens it used.

### Claude Code integration (optional)

[The companion](#the-companion-claude-plan-and-mcp)'s **MCP server** gives Claude Code the same tools
for a local clone of your notes repository, so you can ask it to reorganise or link notes directly.
It asks before each change, and the edits are ordinary file changes that `git diff` shows before you
commit.

### Limits to know

- **Model quality:** answers are only as good as the model; small models search less well.
- **Free models:** they have low daily limits, and the agent makes several requests per question.
- **Remote providers see what's read:** a remote provider receives the text of every note the agent
  reads. The *Read N notes* list shows exactly which ones.

## The companion (Claude plan and MCP)

An optional program that runs on your computer (Node 22), from a clone of this repository. It
has no dependencies to install beyond the repository's own, and builds itself into
`bridge/dist/noted-ai.mjs` when started.

**Use your Claude plan in the app.** Install [Claude Code](https://docs.anthropic.com/claude-code) and
sign in (`claude /login`), then:

```bash
npm run bridge -- --origin https://your-noted-ai.example
```

It prints a pairing link: open it (or paste the pairing code into **Settings → AI → Claude plan**).
Leave out `--origin` when you use noted-ai at `http://localhost`.

- It listens on `127.0.0.1:41414` only, and answers only pages from the given origin (and
  localhost), with a matching Host header, that send the pairing code. The code is kept in
  `~/.noted-ai/bridge-token`, readable only by you; `--new-code` replaces it.
- Each answer runs `claude -p` in an empty temporary folder with Claude Code's own tools, MCP
  servers, skills and settings switched off. The app's agent tools still run in the browser:
  the bridge describes them to Claude in the prompt and turns its replies back into tool calls.
- Notes the agent reads go to Anthropic through Claude Code, under your plan's limits.
  Encrypted repositories are local-only unless you allow remote providers.

**Work on your notes from Claude Code (MCP).** With a local clone of your notes repository:

```bash
npm run build:bridge
```

```bash
claude mcp add noted-ai -- node "$PWD/bridge/dist/noted-ai.mjs" mcp ~/notes
```

Claude Code then has the agent's tools for that folder: search, read (whole notes or sections),
links and backlinks, hubs, tags, properties, folders and repository health; and creating notes,
adding to them, editing, setting properties and linking. Claude Code asks before each change,
and the changes are ordinary file edits, so `git diff` shows them before you commit and the app
syncs them. Add `--read-only` to leave out the tools that change notes, and `--markdown-links` if
the repository uses markdown links.

## Deploy to Vercel (Hobby)

1. In Vercel, **Add New → Project** and import `therealkevops/noted-ai`.
2. Keep the detected defaults (Framework: Next.js, build `next build`). No environment
   variables are needed; `.env.example` lists the one a later phase adds.
3. Deploy. Every push to `main` deploys to production; other branches get preview URLs.

Check a deployment at `/api/health`, which reports the commit it was built from.

The app is designed for the Hobby plan's limits: pages and `/api/health` are static, and
there are no server functions: GitHub and AI providers are called from the browser. See
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
  If the same note changed in both places, edits to different lines are merged. If the same lines
  changed, the note keeps everything that merged and shows GitHub's version of those lines for now,
  with a banner: **Review** shows each clash side by side, to keep GitHub's lines, yours, or both.
  Your version is kept on this device until you choose (the command *Review conflicts* lists them),
  so nothing is lost and no copy files are made.
- Notes, drawings and other text files (`.md`, `.excalidraw`, `.canvas`, `.json`, `.txt`,
  `.csv`) sync, and so do attachments (images, PDFs, audio, video) as binary files. Hidden
  folders such as `.obsidian/` and other file types are left untouched in the repo.
- Drawings, canvases and attachments are never line-merged: if one changed in both places, the
  review offers GitHub's file, yours, or both (yours saved as a copy only if you choose that).

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
- Notes you send to a remote AI provider are sent in the clear (over HTTPS) to that provider;
  encryption protects what's stored on GitHub. By default an encrypted repository only talks to a
  local model; you can allow remote providers in **Settings → AI**.

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
  sync/             sync engine (three-way merge, conflicts kept for review), remote adapter, sync state
  links/            link and tag parsing, Obsidian-style resolution, LinkIndex (backlinks,
                    mentions, graph, rename rewriting)
  drawing/          Excalidraw file parsing (text, links), link rewriting, SVG rendering
  ai/               AI providers, keys, model catalog, local diagnostics, streaming
                    OpenAI-compatible client, chat state
bridge/             the companion: bridge (Claude plan via Claude Code) and MCP server, with tests
tests/e2e/          Playwright tests
docs/PLAN.md        design and roadmap
docs/AI_PLAN.md     AI and agent plan (phases A–E)
```
