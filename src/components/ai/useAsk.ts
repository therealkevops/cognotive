"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { actionPrompt, type AgentAction } from "@/lib/ai/actions";
import { chatStore, type FileView } from "@/lib/ai/chat-store";
import { endpointFor } from "@/lib/ai/endpoint";
import { remoteAllowed } from "@/lib/ai/providers";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { todayStamp } from "@/lib/links/health";
import { isNote } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { useToolEnv } from "./useToolEnv";

/**
 * Sends a question to the chat with the current settings: the agent's tools
 * when it's on, proposals when they're allowed, and a note's text when asked.
 */
export function useAsk() {
  const vault = useVault();
  const { active: vaultConfig } = useVaults();
  const [ai] = useAiSettings();
  const env = useToolEnv();
  // The files proposals are built on: the open note as typed, others as saved.
  const files = useMemo<FileView>(
    () => ({
      text: (p) => vault.textOf(p),
      exists: (p) => vault.exists(p),
      linkFormat: vault.settings.linkFormat,
    }),
    [vault],
  );
  const encrypted = vaultConfig.kind === "github" && !!vaultConfig.encrypted;

  return useCallback(
    async (question: string | null, o: { note?: string | null; openPath?: string | null; prompt?: string } = {}) => {
      if (chatStore.get().busy) return;
      const target = await endpointFor(ai, { remoteAllowed: remoteAllowed(vault.settings.aiRemote, encrypted) });
      if ("error" in target) {
        if (question !== null) chatStore.fail(question, target.error);
        return;
      }
      const text = o.note ? vault.textOf(o.note) : undefined;
      const note = o.note && text !== undefined ? { path: o.note, text } : null;
      // OpenRouter says which models can't use tools; others are tried, and fall back to search.
      await chatStore.send(target.ep, target.model, question, note, {
        env: ai.agent ? env : undefined,
        tools: target.tools,
        maxSteps: ai.maxSteps,
        openPath: o.openPath,
        files: ai.agent && ai.write ? files : undefined,
        prompt: o.prompt,
      });
    },
    [ai, env, files, vault, encrypted],
  );
}

/** Runs an agent action in the chat (and shows the chat). Null outside the workspace. */
export const AiActionsContext = createContext<((a: AgentAction) => void) | null>(null);
export const useAiActions = () => useContext(AiActionsContext);

/** The function behind AiActionsContext: builds the action's prompt and asks it. */
export function useRunAction(showChat: () => void) {
  const vault = useVault();
  const ask = useAsk();
  return useCallback(
    (a: AgentAction) => {
      const p = actionPrompt(a, {
        links: vault.links,
        today: todayStamp(),
        notes: () => vault.entries.filter((e) => e.kind === "file" && isNote(e.path)).map((e) => ({ path: e.path, mtime: e.mtime })),
      });
      showChat();
      void ask(p.label, { note: p.note, prompt: p.prompt });
    },
    [vault, ask, showChat],
  );
}
