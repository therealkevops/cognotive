import { afterEach, describe, expect, it, vi } from "vitest";
import { _clearModelCache, checkOpenRouterKey, defaultModel, fetchModels, groupModels, limitGroups, parseModels, priceLabel, searchModels } from "./catalog";

const openRouter = {
  data: [
    { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", context_length: 200000, supported_parameters: ["tools", "temperature"], pricing: { prompt: "0.000003", completion: "0.000015" } },
    { id: "meta/llama-free", name: "Llama (free)", supported_parameters: ["temperature"], pricing: { prompt: "0", completion: "0" } },
    { name: "no id" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  _clearModelCache();
});

describe("parseModels", () => {
  it("reads OpenRouter's catalog", () => {
    const m = parseModels(openRouter);
    expect(m.map((x) => x.id)).toEqual(["anthropic/claude-sonnet-4.5", "meta/llama-free"]);
    expect(m[0]).toMatchObject({ tools: true, contextLength: 200000, promptPrice: 3, completionPrice: 15 });
    expect(m[1]).toMatchObject({ tools: false, free: true });
  });

  it("reads a plain list (Ollama, LM Studio)", () => {
    expect(parseModels({ object: "list", data: [{ id: "llama3.2:latest", object: "model" }] })).toEqual([
      { id: "llama3.2:latest", name: "llama3.2:latest" },
    ]);
    expect(parseModels(null)).toEqual([]);
  });
});

describe("searchModels and defaults", () => {
  const m = parseModels(openRouter);
  it("matches every word, optionally only tool-capable models", () => {
    expect(searchModels(m, "claude sonnet").map((x) => x.id)).toEqual(["anthropic/claude-sonnet-4.5"]);
    expect(searchModels(m, "", { toolsOnly: true })).toHaveLength(1);
  });
  it("prefers a known good model", () => {
    expect(defaultModel(m)).toBe("anthropic/claude-sonnet-4.5");
    expect(defaultModel(parseModels({ data: [{ id: "a" }] }))).toBe("a");
    expect(defaultModel([])).toBe("");
  });
  it("labels prices", () => {
    expect(priceLabel(m[0])).toBe("$3.0 in · $15 out per M");
    expect(priceLabel(m[1])).toBe("Free");
  });
});

describe("groupModels", () => {
  const free = (id: string, name: string) => ({ id, name, context_length: 1, supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } });
  const paid = (id: string, name: string, tools = true) => ({ id, name, supported_parameters: tools ? ["tools"] : [], pricing: { prompt: "0.000001", completion: "0.000002" } });
  const models = parseModels({
    data: [
      paid("aaa/first", "AAA First"),
      paid("openai/gpt-5.5", "OpenAI: GPT-5.5"),
      paid("anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5"),
      free("zzz/model:free", "ZZZ Model (free)"),
      free("mmm/model:free", "MMM Model (free)"),
      paid("bbb/chat", "BBB Chat", false),
    ],
  });
  const ids = (g: ReturnType<typeof groupModels>["groups"]) => g.map((x) => [x.label, x.models.map((m) => m.id)]);

  it("lists suggested models first, then free ones, then the rest by name", () => {
    const { groups, total } = groupModels(models);
    expect(total).toBe(6);
    expect(ids(groups)).toEqual([
      ["Suggested", ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5"]],
      ["Free", ["mmm/model:free", "zzz/model:free"]],
      ["All models", ["aaa/first", "bbb/chat"]],
    ]);
  });

  it("filters to free models, or to ones that can use tools, and searches within", () => {
    expect(ids(groupModels(models, { filter: "free" }).groups)).toEqual([["Free", ["mmm/model:free", "zzz/model:free"]]]);
    expect(groupModels(models, { filter: "tools" }).total).toBe(5);
    expect(ids(groupModels(models, { query: "zzz" }).groups)).toEqual([["Free", ["zzz/model:free"]]]);
  });

  it("cuts a long list, keeping its order", () => {
    expect(ids(limitGroups(groupModels(models).groups, 3))).toEqual([
      ["Suggested", ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5"]],
      ["Free", ["mmm/model:free"]],
    ]);
  });
});

describe("fetchModels", () => {
  it("fetches once and then uses the cache", async () => {
    const fetchFn = vi.fn(async () => Response.json(openRouter));
    vi.stubGlobal("fetch", fetchFn);
    const ep = { baseUrl: "https://openrouter.ai/api/v1", openRouter: true };
    expect(await fetchModels(ep)).toHaveLength(2);
    expect(await fetchModels(ep)).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await fetchModels(ep, { fresh: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("checkOpenRouterKey", () => {
  it("reads the key's label and limit, and refuses a bad key", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ data: { label: "sk-or-v1-abc...", usage: 1.5, limit: 10, is_free_tier: false } }));
    expect(await checkOpenRouterKey({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" })).toEqual({
      label: "sk-or-v1-abc...",
      usage: 1.5,
      limit: 10,
      freeTier: false,
    });
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
    await expect(checkOpenRouterKey({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k" })).rejects.toMatchObject({ kind: "auth" });
  });
});
