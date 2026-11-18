import { buildMessages, type NoteContext } from "./context";
import { AiError, streamChat, type ChatMessage, type Endpoint } from "./openai-compatible";

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
}

export interface ChatState {
  scope: string;
  turns: ChatTurn[];
  busy: boolean;
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
  async send(ep: Endpoint, model: string, question: string | null, note: NoteContext | null) {
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
    let text = "";
    const answer = (patch: Partial<ChatTurn>) => {
      if (controller !== ctrl || state.scope !== scope) return; // reset meanwhile
      emit({ turns: [...turns, { role: "assistant", content: text, ...patch }] });
    };
    emit({ turns: [...turns, { role: "assistant", content: "", pending: true }], busy: true });
    try {
      await streamChat(ep, {
        model,
        messages: buildMessages(history, note),
        signal: ctrl.signal,
        onText(t) {
          text += t;
          answer({ pending: true });
        },
      });
      answer(text ? {} : { error: "The model sent an empty reply." });
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(String((e as Error)?.message ?? e), "network");
      answer(err.kind === "aborted" ? { stopped: true } : { error: err.message });
    } finally {
      if (controller === ctrl) {
        controller = null;
        emit({ busy: false });
      }
    }
  },
};
