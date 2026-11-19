"use client";

import { ArrowUp, ChevronRight, FileDown, FileText, RotateCcw, Search, Settings, Sparkles, Square, SquarePen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { chatStore, type ChatTurn } from "@/lib/ai/chat-store";
import { chatMarkdown, chatTitle } from "@/lib/ai/context";
import { formatLink } from "@/lib/links/format";
import { todayStamp } from "@/lib/links/health";
import { joinPath, uniquePath } from "@/lib/vault/paths";
import { ProposalList } from "./Proposals";
import { useAiActions, useAsk } from "./useAsk";
import { loadKey } from "@/lib/ai/keys";
import { PROVIDERS, remoteAllowed } from "@/lib/ai/providers";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { splitLinkText } from "@/lib/links/parse";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { renderMarkdown } from "@/lib/markdown/render";
import { displayName, isNote } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";

/**
 * A conversation with the chosen model, about the open note. Answers stream
 * in and can be stopped; links in them open notes.
 */
export function ChatPanel({
  links,
  onOpenLink,
  onOpenSettings,
}: {
  links: LinkContext;
  onOpenLink(target: string): void;
  onOpenSettings(): void;
}) {
  const vault = useVault();
  const { active: vaultConfig } = useVaults();
  const [ai] = useAiSettings();
  const chat = useSyncExternalStore(chatStore.subscribe, chatStore.get, chatStore.get);
  const [draft, setDraft] = useState("");
  const [withNote, setWithNote] = useState(true);
  const [keyState, setKeyState] = useState<{ provider: string; has: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A conversation belongs to one repository.
  useEffect(() => {
    if (chat.scope !== vault.vaultId) chatStore.reset(vault.vaultId);
  }, [chat.scope, vault.vaultId]);

  const { preset, model, baseUrl } = { preset: PROVIDERS[ai.provider], ...ai.providers[ai.provider] };
  useEffect(() => {
    let live = true;
    const check = () => void loadKey(ai.provider).then((k) => live && setKeyState({ provider: ai.provider, has: !!k }));
    check();
    // Saving or removing a key in Settings announces it.
    window.addEventListener("noted-ai-keys", check);
    return () => {
      live = false;
      window.removeEventListener("noted-ai-keys", check);
    };
  }, [ai.provider]);
  const hasKey = keyState?.provider === ai.provider ? keyState.has : null;

  const encrypted = vaultConfig.kind === "github" && !!vaultConfig.encrypted;
  const blocked = !preset.local && !remoteAllowed(vault.settings.aiRemote, encrypted);
  const notePath = vault.active?.path && isNote(vault.active.path) ? vault.active.path : null;
  const setup: string | null = blocked
    ? "This repository only allows local models. Choose the Local provider in Settings → AI."
    : preset.requiresKey && hasKey === false
      ? `Add your ${preset.label} ${preset.keyLabel} in Settings → AI to start.`
      : !baseUrl
        ? "Set the provider's address in Settings → AI."
        : !model
          ? "Choose a model in Settings → AI."
          : null;

  // Follow the answer as it streams, unless the reader scrolled up.
  const last = chat.turns.at(-1);
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [last?.content, chat.turns.length]);

  const ask = useAsk();
  const aiAction = useAiActions();

  const saveAsNote = async () => {
    const first = chat.turns.find((t) => t.role === "user");
    if (!first) return;
    const title = chatTitle(first.content);
    const date = todayStamp();
    const folder = vault.settings.aiFolder || "AI";
    const path = uniquePath(joinPath(folder, `${date} ${title}.md`), (p) => vault.exists(p));
    const link = (p: string) => formatLink(vault.settings.linkFormat, path, { path: p, target: vault.links.linkText(p) }, vault.links.linkText(p));
    await vault.createNoteWith(path, chatMarkdown(chat.turns, { title, date, model, link }));
  };

  const send = async (question: string | null) => {
    if (setup || chat.busy) return;
    void ask(question, { note: withNote ? notePath : null, openPath: notePath });
  };

  const submit = () => {
    const q = draft.trim();
    if (!q || setup || chat.busy) return;
    setDraft("");
    void send(q);
  };

  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (a?.classList.contains("internal-link")) {
      e.preventDefault();
      onOpenLink(splitLinkText(a.dataset.href ?? "").target);
    }
  };

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col text-sm">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          className="min-w-0 flex-1 truncate rounded px-1 text-left text-xs text-muted hover:text-foreground"
          title="Change the model in Settings → AI"
          onClick={onOpenSettings}
        >
          {preset.label}
          {model && ` · ${model}`}
        </button>
        <button
          type="button"
          className="icon-button h-7 w-7"
          aria-label="Save chat as a note"
          title={`Save chat as a note (in ${vault.settings.aiFolder || "AI"}/)`}
          disabled={chat.busy || !chat.turns.some((t) => t.role === "assistant" && t.content)}
          onClick={() => void saveAsNote()}
        >
          <FileDown size={15} aria-hidden />
        </button>
        <button
          type="button"
          className="icon-button h-7 w-7"
          aria-label="New chat"
          title="New chat"
          disabled={chat.turns.length === 0}
          onClick={() => {
            chatStore.reset();
            inputRef.current?.focus();
          }}
        >
          <SquarePen size={15} aria-hidden />
        </button>
        <button type="button" className="icon-button h-7 w-7" aria-label="AI settings" title="AI settings" onClick={onOpenSettings}>
          <Settings size={15} aria-hidden />
        </button>
      </div>

      <div ref={listRef} className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1" aria-live="polite" onClick={onClick}>
        {chat.turns.length === 0 && (
          <div className="py-6 text-center text-muted">
            <Sparkles size={20} aria-hidden className="mx-auto mb-2 opacity-60" />
            {setup ? (
              <>
                <p>{setup}</p>
                <button type="button" className="button-primary mt-3 py-1 text-sm" onClick={onOpenSettings}>
                  Open AI settings
                </button>
              </>
            ) : (
              <>
                <p>Ask about {notePath ? `“${displayName(notePath)}”` : "your notes"}: summarise it, find gaps, or think it through.</p>
                {aiAction && (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Suggestions">
                    {notePath && (
                      <button type="button" className="properties-chip px-2" onClick={() => aiAction({ kind: "summarise", path: notePath })}>
                        Summarise this note
                      </button>
                    )}
                    {notePath && ai.agent && (
                      <button type="button" className="properties-chip px-2" onClick={() => aiAction({ kind: "suggest-links", path: notePath })}>
                        Suggest links
                      </button>
                    )}
                    <button type="button" className="properties-chip px-2" onClick={() => aiAction({ kind: "daily-review" })}>
                      What did I work on this week?
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {chat.turns.map((t, i) => (
          <Turn
            key={i}
            turn={t}
            links={links}
            last={i === chat.turns.length - 1}
            onRetry={() => void send(null)}
            onOpen={onOpenLink}
            busy={chat.busy}
          />
        ))}
      </div>

      <form
        className="mt-2 rounded-lg border border-border bg-background focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {notePath && (
          <div className="flex px-2 pt-2">
            <button
              type="button"
              className={`properties-chip max-w-full gap-1 px-2 ${withNote ? "" : "line-through opacity-50"}`}
              aria-pressed={withNote}
              title={withNote ? "The open note is sent with your question. Click to leave it out." : "Click to include the open note"}
              onClick={() => setWithNote((v) => !v)}
            >
              <FileText size={11} aria-hidden className="shrink-0" />
              <span className="truncate">{displayName(notePath)}</span>
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          aria-label="Message"
          className="block max-h-40 min-h-[2.5rem] w-full resize-none bg-transparent px-3 py-2 outline-none"
          rows={2}
          placeholder={setup ? "Set up AI to chat" : "Ask a question…"}
          disabled={!!setup}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape" && chat.busy) {
              e.stopPropagation();
              chatStore.stop();
            }
          }}
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-[11px] text-muted">{preset.local ? "Stays on this machine" : `Sent to ${preset.label}`}</span>
          {chat.busy ? (
            <button type="button" className="icon-button h-7 w-7 bg-foreground/10" aria-label="Stop" title="Stop (Esc)" onClick={() => chatStore.stop()}>
              <Square size={12} aria-hidden fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="icon-button h-7 w-7 bg-accent text-white disabled:opacity-40" aria-label="Send" title="Send (Enter)" disabled={!draft.trim() || !!setup}>
              <ArrowUp size={15} aria-hidden />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Turn({
  turn,
  links,
  last,
  busy,
  onRetry,
  onOpen,
}: {
  turn: ChatTurn;
  links: LinkContext;
  last: boolean;
  busy: boolean;
  onRetry(): void;
  onOpen(path: string): void;
}) {
  const html = useMemo(() => (turn.role === "assistant" && turn.content ? renderMarkdown(turn.content, links) : ""), [turn.role, turn.content, links]);
  if (turn.role === "user") {
    return (
      <div className="ml-6 rounded-lg bg-accent/10 px-3 py-2 whitespace-pre-wrap" data-role="user">
        {turn.content}
      </div>
    );
  }
  return (
    <div data-role="assistant" aria-busy={turn.pending || undefined}>
      <Activity turn={turn} onOpen={onOpen} />
      {html ? (
        <div className="prose-note chat-answer" dangerouslySetInnerHTML={{ __html: html }} />
      ) : turn.pending ? (
        <p className="animate-pulse text-muted">Thinking…</p>
      ) : null}
      {turn.proposals?.length ? <ProposalList proposals={turn.proposals} onOpen={onOpen} /> : null}
      {turn.stopped && <p className="mt-1 text-xs text-muted">Stopped.</p>}
      {turn.limited && <p className="mt-1 text-xs text-muted">Reached the step limit (Settings → AI), so this answer may be incomplete.</p>}
      {!turn.pending && turn.tokens ? (
        <p className="mt-1 text-[11px] text-muted tabular-nums">
          {turn.tokens >= 1000 ? `${(turn.tokens / 1000).toFixed(1)}k` : turn.tokens} tokens
        </p>
      ) : null}
      {turn.error && (
        <div role="alert" className="mt-1 rounded-md bg-[#c2412d]/10 px-2 py-1.5 text-xs">
          {turn.error}
        </div>
      )}
      {last && !busy && (turn.error || turn.stopped) && (
        <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline" onClick={onRetry}>
          <RotateCcw size={11} aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

/**
 * What the agent did for an answer: while it works, its latest step; after,
 * "Read N notes" opening to every step and the notes whose text it was sent.
 */
function Activity({ turn, onOpen }: { turn: ChatTurn; onOpen(path: string): void }) {
  const steps = turn.steps ?? [];
  const read = turn.read ?? [];
  if (turn.pending && steps.length) {
    return (
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted" role="status">
        <Search size={11} aria-hidden className="animate-pulse" />
        {steps.at(-1)}…
      </p>
    );
  }
  if (!read.length && !steps.length && !turn.bySearch) return null;
  const summary = read.length ? `Read ${read.length} ${read.length === 1 ? "note" : "notes"}` : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  return (
    <details className="chat-activity mb-1.5 text-xs text-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded px-1 hover:text-foreground">
        <ChevronRight size={11} aria-hidden className="chat-activity-chevron transition-transform" />
        {summary}
        {turn.bySearch && " · answered from search results"}
      </summary>
      <div className="mt-1 ml-1 space-y-1.5 border-l border-border pl-3">
        {read.length > 0 && (
          <ul aria-label="Notes read" className="flex flex-wrap gap-1">
            {read.map((p) => (
              <li key={p}>
                <button type="button" className="properties-chip px-2" title={p} onClick={() => onOpen(p)}>
                  {displayName(p)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {steps.length > 0 && (
          <ol aria-label="Steps" className="space-y-0.5">
            {steps.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ol>
        )}
        {turn.bySearch && <p>This model can&apos;t use tools, so it was given the notes that best match the question.</p>}
      </div>
    </details>
  );
}
