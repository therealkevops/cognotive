# noted-ai: AI and agent plan

How to bring agentic AI into noted-ai, borrowing the provider design of
[Rabbithole](https://github.com/shlokkhemani/rabbithole) (OpenRouter, a local AI server, or any
OpenAI-compatible endpoint, called straight from the browser) and building the agent on the
repository's own structure: links, hubs, properties, tags and health checks.

**Status:** phases A (providers and chat), B (read agent) and C (write proposals, save chat as
note, Ask) are done; phase D (agent actions) is next. Ask uses Ctrl/Cmd+Shift+Enter, because
Chrome keeps Ctrl+Shift+A for tab search. `get_open_note` became part of the prompt instead of a tool: the open note's text goes with
a question while its chip is on, and only its path otherwise.

This replaces section 5 ("Querying with the LLM") and phase 5 of [PLAN.md](PLAN.md), which assumed
a server-side Claude proxy with a key held on Vercel.

---

## 1. What we take from Rabbithole

Rabbithole's web app is a static site, like noted-ai, and calls models directly from the browser.
The parts worth copying (in `src/web/provider/` and `src/web/settings/` of that repository):

| Rabbithole | What it does | In noted-ai |
|---|---|---|
| `provider-registry.js` | A few provider presets, all speaking the **OpenAI-compatible** Chat Completions API: OpenRouter (`https://openrouter.ai/api/v1`, key required), Local (`http://localhost:11434/v1`, Ollama's default, no key), Custom (any base URL, optional key), and a subscription bridge. Each preset keeps its own model and settings, so switching back restores them. | Same presets and per-preset settings. |
| `openai-compatible.js` | One provider class: `POST {base}/chat/completions` with `stream: true`, parses SSE `data:` lines, adds OpenRouter's `HTTP-Referer` / `X-Title` headers, turns 401/429 into plain-English errors. | Same, plus **tool calls** (Rabbithole doesn't need them). |
| `model-catalog.js` | The OpenRouter model list (`GET /models`, public, no key), cached for an hour, searchable, with a short "suggested" list. | Same, and also reads each model's `supported_parameters` to know which models can use **tools**. |
| `model-endpoint.js` | `GET {base}/models` for local and custom endpoints; tags requests to `localhost` and private addresses with `targetAddressSpace`, so Chrome's local-network permission prompt works. | Same. |
| `ollama-diagnostics.js` | Works out *why* Ollama isn't reachable: browser permission denied, not running, CORS origin not allowed, no models pulled. It can also pull a recommended model with progress. | Same diagnosis with step-by-step fixes (including `OLLAMA_ORIGINS`), plus LM Studio. |
| `credential-store.js`, `key-validation.js` | Keys only on this device, per provider, optionally for this session only; OpenRouter keys checked with `GET /key`; spots an Anthropic or OpenAI key pasted in the wrong place. | Same rules, kept in IndexedDB like GitHub tokens. |
| `src/node/bridge/` | `npx … bridge`: a loopback-only server that lets the page use a signed-in Claude Code or Codex subscription through an OpenAI-compatible endpoint, with a pairing token and origin checks. | **Later** (phase E): the same idea, plus an MCP server so Claude Code can work with the notes directly. |

What we *don't* copy: Rabbithole's branching-canvas document model. noted-ai already has notes,
links and canvases, and the agent's results go into those.

---

## 2. Principles

1. **No server, no shared key.** The browser talks to the provider directly with the user's own
   key (OpenRouter, a custom endpoint) or to a local model. Nothing passes through Vercel, which
   keeps within the Hobby plan and the "keep work in the browser" rule. The planned `/api/chat`
   proxy is dropped; CLAUDE.md's note about it gets updated when phase A lands.
2. **Keys stay on the device.** API keys are kept per repository-independent provider in IndexedDB
   (`noted-ai:ai-keys`), never in settings, never synced, never in the repository. A "this session
   only" option keeps a key in memory only.
3. **Local first where it matters.** A local model (Ollama, LM Studio, llama.cpp) keeps notes on the
   machine. That's the recommended choice for **encrypted repositories**; with a remote provider,
   the chat says which notes were sent.
4. **The agent reads freely and writes only with approval.** Read tools run straight away. Every
   write (new note, edit, property, link) is a *proposal* shown as a diff, which you accept or
   reject, and accepted changes are ordinary edits (undo, sync, version history all work).
5. **Notes are data, not instructions.** Text from notes is passed to the model as tool results,
   never as system instructions, and write tools always need approval, so a note that says "delete
   everything" can't make anything happen on its own.
6. **Works with any model.** Tool calling where the model supports it; otherwise a fallback that
   searches for relevant notes first and answers from those.

---

## 3. Architecture

```
Browser (noted-ai)
├─ AI settings (Settings → AI): provider preset, base URL, model, key (IndexedDB)
├─ Provider: OpenAI-compatible client ─────────────► openrouter.ai/api/v1
│    stream: true, tools, abort                  ├──► localhost:11434/v1 (Ollama)
│                                                └──► any custom /v1 endpoint
├─ Agent loop (browser)
│    send messages + tool schemas → stream text / tool calls
│    run tools against the local index → append results → next turn
│    (max steps, token budget, Stop button)
├─ Tools: read (search, notes, links, hubs, properties, tags, health)
│         write (proposals: create, edit, append, set property, link)
└─ UI: Chat panel (right sidebar), inline "Ask" on a selection,
       proposal review (diffs), agent actions in the palette, Repository health and Properties
```

New code, in the existing layout:

| Path | What |
|---|---|
| `src/lib/ai/providers.ts` | Presets, per-preset settings, normalising base URLs |
| `src/lib/ai/openai-compatible.ts` | Streaming client: text deltas, tool-call deltas (assembled across chunks), usage, errors |
| `src/lib/ai/catalog.ts` | OpenRouter model list (tools and vision flags, prices), local `/models` discovery |
| `src/lib/ai/diagnostics.ts` | Local server checks (permission, running, CORS, models) |
| `src/lib/ai/keys.ts` | Key storage (IndexedDB / session memory) and validation |
| `src/lib/ai/agent.ts` | The tool loop, framework-free and unit-tested against a fake provider |
| `src/lib/ai/tools.ts` | Tool definitions (JSON schemas) and handlers over `LinkIndex`, `NoteIndex`, properties |
| `src/lib/ai/proposals.ts` | Write proposals: what changes, the diff, applying it |
| `src/lib/ai/context.ts` | Fitting notes into the context window: sections, truncation, citations |
| `src/components/ai/*` | Settings section, chat panel, proposal review, inline ask |
| `tests/e2e/fake-llm.ts` | A scripted OpenAI-compatible server inside the page (like `fake-github.ts`), so tests never call a real model |

### The agent loop

1. Build messages: a short system prompt (what noted-ai is, the open note's path, how to cite),
   the conversation, and the tool schemas.
2. Stream one completion. Text goes to the chat as it arrives; `tool_calls` are collected.
3. Run each tool call in the browser. Reads return results straight away; writes become pending
   proposals and return "proposed, waiting for the user" to the model.
4. Append the results and go back to 2, until the model answers without tools, a step limit is
   reached (default 12), or the user presses **Stop** (an `AbortController`).
5. The answer cites notes as `[[Note]]` links, which open the note. A "Read 4 notes" row above the
   answer lists exactly what was sent.

**Models without tool support** (many small local models): search the index with the question,
put the best few notes (by section) in the prompt, and ask for an answer with citations. The chat
says "answered from search results" so it's clear.

### Tools

Read (run without asking):

| Tool | Returns |
|---|---|
| `search_notes(query, limit)` | Keyword search with snippets; also understands `tag:x` and `[key:value]` |
| `read_note(path, section?)` | A note's text, whole or one heading's section, with its properties |
| `get_links(path, direction)` | Outgoing links, backlinks, unlinked mentions, canvas relations |
| `traverse(path, depth)` | Notes within N links, with how they connect |
| `list_hubs()` / `hub_for(path)` | Pinned and detected hubs; the hubs a note is in or could join |
| `find_by_tag(tag)` / `find_by_property(key, value?)` | Structured queries (existing search functions) |
| `list_folder(path)` | Files and folders |
| `repository_health()` | Score, broken links, orphans, dead ends, stale hubs, hubs to write |
| `get_open_note()` | What the user is looking at, and any selection |

Write (proposals, shown as diffs):

| Tool | Proposes |
|---|---|
| `create_note(path, content, properties?)` | A new note (it can't overwrite one) |
| `append_to_note(path, text, under_heading?)` | Adding text at the end or under a heading |
| `edit_note(path, find, replace)` | A precise replacement (must match exactly once) |
| `set_property(path, key, value)` | A property change (any file type, via `vault.setProperty`) |
| `add_link(from, to, text?)` | Linking a mention, or adding to a hub's Notes section |

Proposals appear in a **Changes** tray in the chat: each with a diff (reusing the conflict review's
side-by-side view), **Apply**, **Edit**, or **Reject**, and **Apply all**. Applying writes through
the vault, so changes are saved, indexed and synced like typed edits.

---

## 4. What the agent does (user-facing)

**Chat panel** (a third tab in the right sidebar, next to Connections and Outline):
ask about the repository ("what have I written about X, and how does it connect to Y?"), with
cited notes. Context chips show what's included: the open note, a selection, a hub, search
results. Conversations can be saved as a note (`AI/2026-11-18 Question.md`) so they sync.

**Ask anywhere** (Rabbithole's idea, noted-ai style): select text in a note and choose **Ask** (or
Ctrl/Cmd+Shift+A). The answer streams into a popover; **Save as note** makes it a new note linked
from the selection, so explorations become part of the graph instead of disappearing.

**Agent actions**, from the command palette and where they belong:

| Action | Where | What happens |
|---|---|---|
| Summarise this note | Palette, note menu | Summary in chat; "Save as property" writes `summary:` |
| Suggest links | Connections panel | Reads related notes, proposes `[[links]]` where they're mentioned |
| Suggest tags and properties | Properties panel | Proposes tags and property values in the repository's own vocabulary |
| Write this hub | Hubs "To write", link map | Drafts a map of content from the notes that link to it, as a proposal |
| Fix orphans | Repository health | For each orphan, proposes the hub or note it belongs in |
| Review stale hubs | Repository health | Checks each against newer notes and proposes updates (then **Mark reviewed**) |
| Fill properties | Property table | Proposes a value for empty cells in a column, from each note's text |
| Daily review | Today | "What did I work on this week?" from recently changed notes |

Every action shows the proposals before anything changes.

---

## 5. Settings (Settings → AI)

- **Provider:** OpenRouter (recommended), Local, Custom endpoint. Later: Your Claude or ChatGPT plan
  (the bridge).
- **OpenRouter:** paste a key (checked against `GET /key`, showing its label and spend limit), pick a
  model from the searchable catalog. Models that can't use tools are marked. A short suggested list
  sits at the top.
- **Local:** base URL (default `http://localhost:11434/v1` for Ollama; LM Studio is
  `http://localhost:1234/v1`), **Check connection** with the diagnosis and fixes (e.g. "start
  Ollama with `OLLAMA_ORIGINS=https://your-app.vercel.app`"), model list from the server, and
  optionally pulling a recommended model.
- **Custom:** base URL, optional key, model name.
- **Limits:** max steps per question, and whether write tools are offered at all (off = read-only
  agent).
- **Per repository:** an opt-out ("never send this repository's notes to a remote provider"),
  defaulting to on for encrypted repositories, which then only allows a local model.

---

## 6. Phases

Each phase is a branch, tested with the fake LLM server, merged on request.

| Phase | Scope | Done when |
|---|---|---|
| **A. Providers and chat** | Settings → AI (presets, keys, catalog, local diagnostics), streaming client, chat panel without tools (the open note as context), Stop, errors | You can chat about the open note with OpenRouter or a local Ollama model |
| **B. Read agent** | Tool loop, read tools, citations, "Read N notes", fallback for models without tools, context fitting | "What have I written about X?" is answered from several notes, with working citations |
| **C. Write proposals** | Write tools, Changes tray with diffs, apply/reject, save chat as note, ask-anywhere with Save as note | The agent can draft a hub or add links, and nothing changes until you apply it |
| **D. Agent actions** | The actions in section 4, wired into Connections, Properties, Repository health, hubs, Today | Each action works end to end on a sample repository |
| **E. Bridge and MCP (optional)** | A small local companion (`npx noted-ai bridge`): use a Claude Code or Codex subscription via a loopback OpenAI-compatible endpoint (as Rabbithole does), and an MCP server that exposes the same tools so Claude Code can work with a local clone of the repository | Claude Code can answer from and propose changes to your notes |

Phases A and B are the core; C makes it agentic; D is where it pays off day to day.

---

## 7. Testing

- **Unit:** SSE parsing (text and tool-call deltas split across chunks), the agent loop against a
  scripted fake provider (tool calls, errors, step limit, abort), each tool handler against a
  small `LinkIndex`, proposals (diffs, applying, conflicts with edits made meanwhile), key storage,
  catalog parsing.
- **E2E:** `tests/e2e/fake-llm.ts` intercepts `openrouter.ai` and `localhost:11434` in the page and
  replays scripted streams, including tool calls, so the whole loop runs in Playwright with no
  real model. As with GitHub, **never call a real provider in tests**.

---

## 8. Risks and open questions

- **Browser to local server:** Ollama needs `OLLAMA_ORIGINS` to include the app's origin; Chrome
  asks permission for local-network requests from a public site (hence `targetAddressSpace`);
  Safari may block `http://localhost` from an HTTPS page. The diagnostics have to explain each
  case, and the bridge (phase E) is the fallback.
- **Tool support varies:** many local models handle tools poorly. The fallback mode and a
  "tools: yes/no" hint in the model picker cover it; the step limit stops loops.
- **Cost:** OpenRouter bills per token. Show the model's price in the picker, the tokens used per
  answer, and keep tool results compact (sections, snippets) so context stays small.
- **Privacy:** remote providers see the notes the agent reads. The "Read N notes" list, the
  per-repository opt-out and the local-only default for encrypted repositories address it.
- **Prompt injection:** notes are untrusted input to the model. Write tools only propose, and
  proposals are reviewed, so the worst case is a bad suggestion.

**Decisions needed before phase A:**
1. Default provider and model for new users (suggest: OpenRouter with a capable tool-using model,
   with Local one click away).
2. Whether to keep a server-side option at all (the old `/api/chat` with a shared key). This plan
   says no.
3. Where saved conversations go (suggest an `AI/` folder, configurable in Settings → This repository).
