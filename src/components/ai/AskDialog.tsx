"use client";

import { Copy, FileDown, Search, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { runAgent } from "@/lib/ai/agent";
import { buildMessages, chatTitle } from "@/lib/ai/context";
import { endpointFor } from "@/lib/ai/endpoint";
import { AiError, streamChat } from "@/lib/ai/openai-compatible";
import { remoteAllowed } from "@/lib/ai/providers";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { formatLink } from "@/lib/links/format";
import { todayStamp } from "@/lib/links/health";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { renderMarkdown } from "@/lib/markdown/render";
import { displayName, joinPath, noteTitle, uniquePath } from "@/lib/vault/paths";
import { Modal } from "../workspace/Modal";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { useToolEnv } from "./useToolEnv";

export interface AskSource {
  path: string;
  from: number;
  to: number;
  text: string;
}

const QUICK = ["Explain this", "Summarise this", "What else in my notes relates to this?", "What's missing or unclear here?"];

/**
 * Ask about a passage of the open note. The answer streams in and can be
 * saved as a new note, which the passage then links to, so explorations
 * become part of the graph.
 */
export function AskDialog({
  source,
  links,
  onClose,
  onLinkSelection,
  onInsert,
  onOpenSettings,
}: {
  source: AskSource;
  links: LinkContext;
  onClose(): void;
  /** Makes the passage a link to `path` (when it's still there). */
  onLinkSelection(source: AskSource, link: string): void;
  /** Adds text after the passage's paragraph. */
  onInsert(source: AskSource, text: string): void;
  onOpenSettings(): void;
}) {
  const vault = useVault();
  const { active: vaultConfig } = useVaults();
  const [ai] = useAiSettings();
  const env = useToolEnv();
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [answer, setAnswer] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [read, setRead] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const encrypted = vaultConfig.kind === "github" && !!vaultConfig.encrypted;
  const html = useMemo(() => (answer ? renderMarkdown(answer, links) : ""), [answer, links]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setAsked(text);
    setAnswer("");
    setRead([source.path]);
    setError(null);
    setStep(null);
    const target = await endpointFor(ai, { remoteAllowed: remoteAllowed(vault.settings.aiRemote, encrypted) });
    if ("error" in target) return setError(target.error);
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    const quoted = source.text.split("\n").map((l) => `> ${l}`).join("\n");
    const messages = buildMessages(
      [{ role: "user", content: `About this passage from "${source.path}":\n\n${quoted}\n\n${text}` }],
      { path: source.path, text: vault.activeText },
      { agent: ai.agent && target.tools !== false },
    );
    try {
      if (ai.agent) {
        const r = await runAgent({
          ep: target.ep,
          model: target.model,
          messages,
          env,
          tools: target.tools,
          maxSteps: ai.maxSteps,
          signal: c.signal,
          onEvent(e) {
            if (e.type === "text") setAnswer((a) => a + e.delta);
            else if (e.type === "reset") setAnswer("");
            else if (e.type === "step") {
              setStep(e.label);
              setRead((r) => [...r, ...e.read.filter((p) => !r.includes(p))]);
            }
          },
        });
        setAnswer(r.text);
      } else {
        await streamChat(target.ep, { model: target.model, messages, signal: c.signal, onText: (t) => setAnswer((a) => a + t) });
      }
    } catch (e) {
      if (!(e instanceof AiError && e.kind === "aborted")) setError(e instanceof AiError ? e.message : String(e));
    } finally {
      setBusy(false);
      setStep(null);
      if (ctrl.current === c) ctrl.current = null;
    }
  };

  const saveAsNote = async () => {
    // A quick prompt names the note after the passage; a typed question after itself.
    const title = chatTitle(QUICK.includes(asked) ? source.text.trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "") : asked);
    const folder = vault.settings.aiFolder || "AI";
    const path = uniquePath(joinPath(folder, `${title}.md`), (p) => vault.exists(p));
    const sourceLink = formatLink(vault.settings.linkFormat, path, { path: source.path, target: vault.links.linkText(source.path) }, vault.links.linkText(source.path));
    const quoted = source.text.split("\n").map((l) => `> ${l}`).join("\n");
    const content = `---\ncreated: ${todayStamp()}\ntags: [ai-answer]\n---\n# ${title}\n\n${quoted}\n\n*${asked}*\n\n${answer.trim()}\n\nFrom ${sourceLink}\n`;
    await vault.writeFile(path, content);
    const target = noteTitle(path);
    onLinkSelection(source, formatLink(vault.settings.linkFormat, source.path, { path, target, alias: source.text.trim() === target ? undefined : source.text.trim() }, target));
    onClose();
  };

  return (
    <Modal label="Ask about the selection" onClose={onClose} wide>
      <blockquote className="max-h-24 overflow-y-auto border-l-2 border-accent/50 pl-3 text-sm whitespace-pre-wrap text-muted" aria-label="Selection">
        {source.text}
      </blockquote>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          className="input flex-1"
          aria-label="Question"
          placeholder="Ask about this…"
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        {busy ? (
          <button type="button" className="button-secondary" onClick={() => ctrl.current?.abort()}>
            <Square size={12} aria-hidden fill="currentColor" /> Stop
          </button>
        ) : (
          <button type="submit" className="button-primary" disabled={!question.trim()}>
            Ask
          </button>
        )}
      </form>
      {!asked && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} type="button" className="properties-chip px-2" onClick={() => void ask(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      {(answer || busy || error) && (
        <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-lg border border-border p-3" aria-live="polite" aria-label="Answer">
          {step && busy && (
            <p className="mb-1 flex items-center gap-1.5 text-xs text-muted" role="status">
              <Search size={11} aria-hidden className="animate-pulse" /> {step}…
            </p>
          )}
          {html ? (
            <div className="prose-note chat-answer" dangerouslySetInnerHTML={{ __html: html }} />
          ) : busy ? (
            <p className="animate-pulse text-sm text-muted">Thinking…</p>
          ) : null}
          {error && (
            <div role="alert" className="text-sm text-[#c2412d]">
              {error}{" "}
              {/Settings → AI/.test(error) && (
                <button type="button" className="text-accent underline" onClick={onOpenSettings}>
                  Open AI settings
                </button>
              )}
            </div>
          )}
          {!busy && read.length > 1 && (
            <p className="mt-2 text-xs text-muted">Read {read.map((p) => displayName(p)).join(", ")}</p>
          )}
        </div>
      )}
      {answer && !busy && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="button-primary" onClick={() => void saveAsNote()} title="A new note with the answer, linked from the selection">
            <FileDown size={14} aria-hidden /> Save as note
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onInsert(source, answer.trim());
              onClose();
            }}
          >
            Insert below
          </button>
          <button type="button" className="button-secondary" onClick={() => void navigator.clipboard?.writeText(answer.trim())}>
            <Copy size={14} aria-hidden /> Copy
          </button>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted">
            <Sparkles size={11} aria-hidden /> {ai.providers[ai.provider].model}
          </span>
        </div>
      )}
    </Modal>
  );
}
