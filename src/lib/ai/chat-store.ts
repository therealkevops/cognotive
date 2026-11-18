import { runAgent } from "./agent";
import { buildMessages, type NoteContext } from "./context";
import { AiError, streamChat, type ChatMessage, type Endpoint } from "./openai-compatible";
import type { ToolEnv } from "./tools";

/**
 * The current conversation, kept outside React so it survives switching panel
 * tabs (and keeps streaming while the panel is hidden).
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** User turns: the note that was sent with the question. */
  note?: string;
  /** Assistant turns: still arriving, stopped by the user, or failed. */
  pending?: boolean;
  stopped?: boolean;
  error?: string;
  /** What the agent did, and the notes whose text went to the model. */
  steps?: string[];
  read?: string[];
  /** Answered from search results, because the model can't use tools. */
  bySearch?: boolean;
  /** Ran out of steps. */
  limited?: boolean;
  tokens?: number;
}

export interface ChatState {
  scope: string;
  turns: ChatTurn[];
  busy: boolean;
}

export interface AskOptions {
  /** The repository the agent can read; without it, the model only sees the open note. */
  env?: ToolEnv;
  /** False when the model is known not to use tools. */
  tools?: boolean;
  maxSteps?: number;
  /** The open note's path, when its text isn't sent. */
  openPath?: string | null;
}

let state: ChatState = { scope: "", turns: [], busy: false };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

const emit = (next: Partial<ChatState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const chatStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Starts over; also when the scope (the repository) changes. */
  reset(scope = state.scope) {
    controller?.abort();
    controller = null;
    emit({ scope, turns: [], busy: false });
  },
  stop() {
    controller?.abort();
  },
  /** Asks a question (or, with no question, asks the last one again). */
  async send(ep: Endpoint, model: string, question: string | null, note: NoteContext | null, opts: AskOptions = {}) {
    if (state.busy) return;
    let turns = state.turns;
    if (question === null) {
      // Retry: drop the failed answer and ask again.
      if (turns.at(-1)?.role === "assistant") turns = turns.slice(0, -1);
      if (turns.at(-1)?.role !== "user") return;
    } else {
      turns = [...turns, { role: "user", content: question, ...(note ? { note: note.path } : {}) }];
    }
    const history: ChatMessage[] = turns
      .filter((t) => !t.error && (t.role === "user" || t.content))
      .map((t) => ({ role: t.role, content: t.content }));
    const ctrl = new AbortController();
    controller = ctrl;
    const scope = state.scope;
    const env = opts.env;
    let answer: ChatTurn = { role: "assistant", content: "", pending: true, steps: [], read: note ? [note.path] : [] };
    const update = (patch: Partial<ChatTurn>) => {
      if (controller !== ctrl || state.scope !== scope) return; // reset meanwhile
      answer = { ...answer, ...patch };
      emit({ turns: [...turns, answer] });
    };
    emit({ turns: [...turns, answer], busy: true });
    const messages = buildMessages(history, note, { agent: !!env && opts.tools !== false, openPath: opts.openPath });
    const addRead = (paths: string[]) => [...(answer.read ?? []), ...paths.filter((p) => !answer.read?.includes(p))];
    try {
      if (!env) {
        // No repository to read from: one plain answer.
        await streamChat(ep, {
          model,
          messages,
          signal: ctrl.signal,
          onText: (t) => update({ content: answer.content + t }),
        });
        update({ pending: false, ...(answer.content ? {} : { error: "The model sent an empty reply." }) });
      } else {
        const r = await runAgent({
          ep,
          model,
          messages,
          env,
          tools: opts.tools,
          maxSteps: opts.maxSteps,
          signal: ctrl.signal,
          onEvent(e) {
            if (e.type === "text") update({ content: answer.content + e.delta });
            else if (e.type === "reset") update({ content: "" });
            else if (e.type === "mode") update({ bySearch: true });
            else update({ steps: [...(answer.steps ?? []), e.label], read: addRead(e.read) });
          },
        });
        const tokens = r.usage.prompt + r.usage.completion;
        update({
          pending: false,
          content: r.text || answer.content,
          ...(r.limited ? { limited: true } : {}),
          ...(tokens ? { tokens } : {}),
          ...(r.text || answer.content ? {} : { error: "The model sent an empty reply." }),
        });
      }
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(String((e as Error)?.message ?? e), "network");
      update(err.kind === "aborted" ? { pending: false, stopped: true } : { pending: false, error: err.message });
    } finally {
      if (controller === ctrl) {
        controller = null;
        emit({ busy: false });
      }
    }
  },
};
