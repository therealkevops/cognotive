"use client";

import { Check, Wrench } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  checkOpenRouterKey,
  defaultModel,
  fetchModels,
  priceLabel,
  searchModels,
  type KeyStatus,
  type ModelInfo,
} from "@/lib/ai/catalog";
import { bridgeAdvice, diagnoseBridge, diagnoseLocal, localAdvice, type BridgeStatus, type LocalStatus } from "@/lib/ai/diagnostics";
import { forgetKey, keyHint, loadKey, saveKey } from "@/lib/ai/keys";
import { AiError } from "@/lib/ai/openai-compatible";
import { LOCAL_SERVERS, PROVIDERS, remoteAllowed, type AiSettings, type ProviderId } from "@/lib/ai/providers";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { Group, Row, SectionHeader, Switch, TextSetting } from "../settings/parts";

/**
 * Settings → AI: which provider answers, its address, key and model. All of it
 * stays in this browser; keys never go into settings files or the repository.
 */
export function AiSection() {
  const [s, set] = useAiSettings();
  const slot = s.providers[s.provider];
  const preset = PROVIDERS[s.provider];
  const patch = (p: Partial<{ baseUrl: string; model: string }>) =>
    set({ ...s, providers: { ...s.providers, [s.provider]: { ...slot, ...p } } });
  const urlId = useId();

  return (
    <section aria-label="AI">
      <SectionHeader
        title="AI"
        description="Chat about your notes with a model of your choice. Requests go straight from this browser to the provider; keys stay on this device."
      />
      <Group title="Provider">
        <div role="radiogroup" aria-label="Provider" className="grid gap-2 py-4 sm:grid-cols-2">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
            const p = PROVIDERS[id];
            const on = s.provider === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`rounded-lg border p-3 text-left transition-colors ${on ? "border-accent bg-accent/5" : "border-border hover:bg-foreground/5"}`}
                onClick={() => set({ ...s, provider: id })}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {p.label}
                  {id === "openrouter" && <span className="text-[11px] font-normal text-muted">Recommended</span>}
                  {on && <Check size={14} aria-hidden className="ml-auto text-accent" />}
                </span>
                <span className="mt-1 block text-xs leading-snug text-muted">{p.description}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title={preset.label}>
        {s.provider !== "openrouter" && (
          <Row
            label="Address"
            id={urlId}
            description={
              s.provider === "local" ? (
                <>
                  The server&apos;s OpenAI-compatible address.{" "}
                  {LOCAL_SERVERS.map((l, i) => (
                    <span key={l.label}>
                      {i > 0 && " · "}
                      <button type="button" className="text-accent hover:underline" onClick={() => patch({ baseUrl: l.baseUrl })}>
                        {l.label}
                      </button>
                    </span>
                  ))}
                </>
              ) : s.provider === "bridge" ? (
                "Where the bridge listens. Change it only if you started the bridge with --port."
              ) : (
                "For example https://api.example.com/v1"
              )
            }
          >
            <TextSetting id={urlId} value={slot.baseUrl} placeholder="http://localhost:11434/v1" onSave={(v) => patch({ baseUrl: v.trim() })} />
          </Row>
        )}
        {preset.allowsKey && <KeyRow key={s.provider} settings={s} onSettings={set} />}
        {s.provider === "local" && <LocalCheck key={slot.baseUrl} baseUrl={slot.baseUrl} model={slot.model} onModel={(model) => patch({ model })} />}
        {s.provider === "openrouter" && <OpenRouterModels model={slot.model} onModel={(model) => patch({ model })} />}
        {s.provider === "bridge" && <BridgeCheck key={slot.baseUrl} baseUrl={slot.baseUrl} model={slot.model} onModel={(model) => patch({ model })} />}
        {s.provider === "custom" && <CustomModel key={slot.baseUrl} settings={s} onModel={(model) => patch({ model })} />}
      </Group>

      <AgentGroup settings={s} onSettings={set} />

      <PrivacyGroup />
    </section>
  );
}

/** The provider's API key: saved on this device (or for this session), checked, forgotten. */
function KeyRow({ settings: s, onSettings }: { settings: AiSettings; onSettings(s: AiSettings): void }) {
  const provider = s.provider;
  const noun = PROVIDERS[provider].keyLabel;
  const short = noun === "API key" ? "key" : "code";
  const id = useId();
  const [stored, setStored] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void loadKey(provider).then((k) => live && setStored(k));
    return () => {
      live = false;
    };
  }, [provider]);

  const check = async (key: string) => {
    if (provider !== "openrouter") return;
    setBusy(true);
    try {
      const k: KeyStatus = await checkOpenRouterKey({ baseUrl: PROVIDERS.openrouter.baseUrl, apiKey: key, openRouter: true });
      const spend =
        k.usage !== undefined ? ` Used $${k.usage.toFixed(2)}${k.limit ? ` of $${k.limit.toFixed(2)}` : ""}.` : "";
      setStatus({ ok: true, text: `Key works${k.label ? ` (${k.label})` : ""}.${spend}${k.freeTier ? " Free tier: free models only." : ""}` });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof AiError ? e.message : "Couldn't check the key." });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    await saveKey(provider, key, s.sessionOnlyKeys);
    setStored(key);
    setDraft("");
    setStatus({ ok: true, text: s.sessionOnlyKeys ? "Saved for this session." : "Saved on this device." });
    void check(key);
  };

  const hint = keyHint(provider, draft);
  const masked = stored ? `${stored.slice(0, 8)}…${stored.slice(-4)}` : "";
  return (
    <>
      <Row
        label={noun[0].toUpperCase() + noun.slice(1)}
        id={id}
        stack
        description={
          provider === "openrouter" ? (
            <>
              Create one at{" "}
              <a className="text-accent hover:underline" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                openrouter.ai/keys
              </a>
              . A spending limit on the key is a good idea.
            </>
          ) : provider === "bridge" ? (
            "The code the bridge printed when it started (opening its pairing link fills this in)."
          ) : (
            "Leave empty if the endpoint doesn't need one."
          )
        }
      >
        {stored ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-foreground/5 px-2 py-1 text-xs" aria-label="Saved key">
              {masked}
            </code>
            {provider === "openrouter" && (
              <button type="button" className="button-secondary py-1 text-sm" disabled={busy} onClick={() => void check(stored)}>
                {busy ? "Checking…" : "Check key"}
              </button>
            )}
            <button
              type="button"
              className="button-secondary py-1 text-sm"
              onClick={async () => {
                await forgetKey(provider);
                setStored("");
                setStatus(null);
              }}
            >
              Remove {short}
            </button>
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              id={id}
              type="password"
              autoComplete="off"
              className="input flex-1"
              placeholder={provider === "openrouter" ? "sk-or-v1-…" : provider === "bridge" ? "Pairing code" : "Optional"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="button-primary" disabled={!draft.trim()}>
              Save {short}
            </button>
          </form>
        )}
        {hint && <p className="mt-1.5 text-xs text-[#c2412d]">{hint}</p>}
        {status && (
          <p role="status" className={`mt-1.5 text-xs ${status.ok ? "text-muted" : "text-[#c2412d]"}`}>
            {status.text}
          </p>
        )}
      </Row>
      <Row
        label="Keep keys for this session only"
        description="Forget keys when this tab closes, instead of saving them on this device."
      >
        <div className="flex sm:justify-end">
          <Switch
            label="Keep keys for this session only"
            checked={s.sessionOnlyKeys}
            onChange={async (v) => {
              onSettings({ ...s, sessionOnlyKeys: v });
              // Move saved keys to where they now belong.
              for (const p of Object.keys(PROVIDERS) as ProviderId[]) {
                const k = await loadKey(p);
                if (k) await saveKey(p, k, v);
              }
            }}
          />
        </div>
      </Row>
    </>
  );
}

/** OpenRouter's catalog: searchable, with prices and whether each model can use tools. */
function OpenRouterModels({ model, onModel }: { model: string; onModel(m: string): void }) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchId = useId();

  useEffect(() => {
    let live = true;
    fetchModels({ baseUrl: PROVIDERS.openrouter.baseUrl, openRouter: true })
      .then((m) => live && setModels(m))
      .catch(() => live && setError("Couldn't load the model list. Check your connection."));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (models?.length && !model) onModel(defaultModel(models));
  }, [models, model, onModel]);

  const shown = useMemo(() => searchModels(models ?? [], query).slice(0, 60), [models, query]);
  const current = models?.find((m) => m.id === model);
  return (
    <Row
      label="Model"
      id={searchId}
      stack
      description={current ? <>Using <strong className="font-medium text-foreground">{current.name}</strong>. {priceLabel(current)}</> : model || undefined}
    >
      {error ? (
        <p className="text-sm text-[#c2412d]">{error}</p>
      ) : !models ? (
        <p className="text-sm text-muted">Loading models…</p>
      ) : (
        <>
          <input
            id={searchId}
            className="input"
            type="search"
            placeholder={`Search ${models.length} models…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul role="listbox" aria-label="Models" className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border">
            {shown.map((m) => (
              <li
                key={m.id}
                role="option"
                aria-selected={m.id === model}
                tabIndex={0}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-foreground/5 ${m.id === model ? "bg-accent/10" : ""}`}
                onClick={() => onModel(m.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onModel(m.id))}
              >
                <span className="min-w-0 flex-1 truncate" title={m.id}>
                  {m.name}
                </span>
                {m.tools === false && (
                  <span className="text-[11px] text-muted" title="Can't use tools: fine for chat, not for agent actions">
                    no tools
                  </span>
                )}
                {m.tools && <Wrench size={12} aria-label="Can use tools" className="text-muted" />}
                <span className="shrink-0 text-[11px] text-muted tabular-nums">{priceLabel(m)}</span>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No models match.</li>}
          </ul>
        </>
      )}
    </Row>
  );
}

/** Checks the local server and lists its models, with fixes when it can't be reached. */
function LocalCheck({ baseUrl, model, onModel }: { baseUrl: string; model: string; onModel(m: string): void }) {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const apply = (st: LocalStatus) => {
    setStatus(st);
    if (st.state === "ready" && !st.models.some((m) => m.id === model)) onModel(st.models[0].id);
  };
  const run = async () => {
    setBusy(true);
    try {
      apply(await diagnoseLocal(baseUrl));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let live = true;
    void diagnoseLocal(baseUrl).then((st) => live && apply(st));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checked once per address (the component is keyed by it)
  }, [baseUrl]);

  const advice = status && localAdvice(status, typeof location === "undefined" ? "" : location.origin);
  return (
    <>
      <Row label="Connection" stack>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-sm" role="status" aria-label="Local connection">
            {!advice ? (
              <span className="text-muted">Checking…</span>
            ) : (
              <>
                <p className={status?.state === "ready" ? "" : "text-[#c2412d]"}>{advice.title}</p>
                {advice.steps.length > 0 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted">
                    {advice.steps.map((s) => (
                      <li key={s}>
                        <code className="break-all">{s}</code>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
          <button type="button" className="button-secondary shrink-0 py-1 text-sm" disabled={busy} onClick={() => void run()}>
            {busy ? "Checking…" : "Check again"}
          </button>
        </div>
      </Row>
      {status?.state === "ready" && (
        <Row label="Model" id={selectId}>
          <select id={selectId} className="input" value={model} onChange={(e) => onModel(e.target.value)}>
            {status.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}

/** The bridge: whether it's running and paired, how to start it, and Claude Code's models. */
function BridgeCheck({ baseUrl, model, onModel }: { baseUrl: string; model: string; onModel(m: string): void }) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const origin = typeof location === "undefined" ? "" : location.origin;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  const command = `npm run bridge${local ? "" : ` -- --origin ${origin}`}`;
  const check = async () => {
    const st = await diagnoseBridge(baseUrl, await loadKey("bridge"));
    setStatus(st);
    // Sonnet by default: quick and capable on any plan.
    if (st.state === "ready" && st.models.length && !st.models.some((m) => m.id === model)) {
      onModel((st.models.find((m) => m.id === "claude/sonnet") ?? st.models[0]).id);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      await check();
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const go = () => void check();
    go();
    // Check again when a pairing code is saved or removed.
    window.addEventListener("noted-ai-keys", go);
    return () => window.removeEventListener("noted-ai-keys", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per address (the component is keyed by it), and on key changes
  }, []);
  const advice = status && bridgeAdvice(status, command);
  return (
    <>
      <Row label="Connection" stack>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-sm" role="status" aria-label="Bridge connection">
            {!advice ? (
              <span className="text-muted">Checking…</span>
            ) : (
              <>
                <p className={status?.state === "ready" ? "" : status?.state === "unpaired" ? "text-muted" : "text-[#c2412d]"}>{advice.title}</p>
                {advice.steps.length > 0 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-muted">
                    {advice.steps.map((st) => (
                      <li key={st}>
                        <code className="break-all">{st}</code>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
          <button type="button" className="button-secondary shrink-0 py-1 text-sm" disabled={busy} onClick={() => void run()}>
            {busy ? "Checking…" : "Check again"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Requests go from this page to the bridge on your computer, then through Claude Code to Anthropic, using your plan&apos;s
          limits. The agent&apos;s tools still run here in the browser.
        </p>
      </Row>
      {status?.state === "ready" && (
        <Row label="Model" id={selectId}>
          <select id={selectId} className="input" value={model} onChange={(e) => onModel(e.target.value)}>
            {status.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
      )}
    </>
  );
}

/** A custom endpoint's model: typed, or picked from its list when it has one. */
function CustomModel({ settings: s, onModel }: { settings: AiSettings; onModel(m: string): void }) {
  const id = useId();
  const listId = useId();
  const { baseUrl, model } = s.providers.custom;
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    let live = true;
    if (!baseUrl) return;
    void loadKey("custom").then((apiKey) =>
      fetchModels({ baseUrl, apiKey })
        .then((m) => live && setModels(m))
        .catch(() => {}),
    );
    return () => {
      live = false;
    };
  }, [baseUrl]);
  return (
    <Row label="Model" id={id} description={models.length ? `${models.length} models available.` : "The model's name, as the endpoint knows it."}>
      <input
        id={id}
        className="input"
        list={models.length ? listId : undefined}
        defaultValue={model}
        key={model}
        placeholder="model-name"
        onBlur={(e) => e.target.value.trim() !== model && onModel(e.target.value.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {models.length > 0 && (
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
      )}
    </Row>
  );
}

/** How far the model may look through the notes by itself. */
function AgentGroup({ settings: s, onSettings }: { settings: AiSettings; onSettings(s: AiSettings): void }) {
  const stepsId = useId();
  return (
    <Group title="Agent">
      <Row
        label="Let the model search and read notes"
        description="It looks things up with tools (search, read, follow links and hubs) and lists every note it read. Off: it only sees the open note."
      >
        <div className="flex sm:justify-end">
          <Switch label="Let the model search and read notes" checked={s.agent} onChange={(agent) => onSettings({ ...s, agent })} />
        </div>
      </Row>
      {s.agent && (
        <Row
          label="Let the model propose changes"
          description="New notes, additions, edits, properties and links, each shown as a change you apply or reject. Off: it only reads."
        >
          <div className="flex sm:justify-end">
            <Switch label="Let the model propose changes" checked={s.write} onChange={(write) => onSettings({ ...s, write })} />
          </div>
        </Row>
      )}
      {s.agent && (
        <Row label="Most steps per question" id={stepsId} description="Each step is one round of lookups. More steps can find more, and cost more.">
          <input
            id={stepsId}
            type="number"
            min={1}
            max={30}
            className="input"
            defaultValue={s.maxSteps}
            key={s.maxSteps}
            onBlur={(e) => {
              const n = Math.min(30, Math.max(1, Math.round(Number(e.target.value) || s.maxSteps)));
              if (n !== s.maxSteps) onSettings({ ...s, maxSteps: n });
              else e.target.value = String(n);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Row>
      )}
    </Group>
  );
}

/** Whether this repository's notes may go to a remote provider at all. */
function PrivacyGroup() {
  const vault = useVault();
  const { active } = useVaults();
  const encrypted = active.kind === "github" && !!active.encrypted;
  const id = useId();
  const folderId = useId();
  const setting = vault.settings.aiRemote;
  return (
    <Group title="This repository">
      <Row
        label="Send notes to remote providers"
        id={id}
        description={
          encrypted
            ? "This repository is encrypted, so by default only a local model may read it."
            : "Choose “Local models only” to keep this repository's notes on your machine."
        }
      >
        <select
          id={id}
          className="input"
          value={setting}
          onChange={(e) => void vault.updateSettings({ aiRemote: e.target.value as typeof setting })}
        >
          <option value="auto">{encrypted ? "Default (local only)" : "Default (allowed)"}</option>
          <option value="allow">Allowed</option>
          <option value="never">Local models only</option>
        </select>
        {!remoteAllowed(setting, encrypted) && <p className="mt-1 text-xs text-muted">The chat will only use the Local provider.</p>}
      </Row>
      <Row label="Folder for saved chats" id={folderId} description="Where “Save as note” puts chats, and answers to “Ask”.">
        <TextSetting
          id={folderId}
          value={vault.settings.aiFolder}
          placeholder="AI"
          onSave={(v) => void vault.updateSettings({ aiFolder: v.trim().replace(/^\/+|\/+$/g, "") || "AI" })}
        />
      </Row>
    </Group>
  );
}
