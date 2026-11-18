"use client";

import { ArrowUp, FileText, RotateCcw, Settings, Sparkles, Square, SquarePen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { chatStore, type ChatTurn } from "@/lib/ai/chat-store";
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
      ? `Add your ${preset.label} key in Settings → AI to start.`
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

  const send = async (question: string | null) => {
    if (setup || chat.busy) return;
    const apiKey = preset.allowsKey ? await loadKey(ai.provider) : "";
    const note = withNote && notePath ? { path: notePath, text: vault.activeText } : null;
    void chatStore.send({ baseUrl, apiKey, openRouter: ai.provider === "openrouter" }, model, question, note);
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
              <p>Ask about {notePath ? `“${displayName(notePath)}”` : "your notes"}: summarise it, find gaps, or think it through.</p>
            )}
          </div>
        )}
        {chat.turns.map((t, i) => (
          <Turn key={i} turn={t} links={links} last={i === chat.turns.length - 1} onRetry={() => void send(null)} busy={chat.busy} />
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
}: {
  turn: ChatTurn;
  links: LinkContext;
  last: boolean;
  busy: boolean;
  onRetry(): void;
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
      {html ? (
        <div className="prose-note chat-answer" dangerouslySetInnerHTML={{ __html: html }} />
      ) : turn.pending ? (
        <p className="animate-pulse text-muted">Thinking…</p>
      ) : null}
      {turn.stopped && <p className="mt-1 text-xs text-muted">Stopped.</p>}
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
