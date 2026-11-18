import { describe, expect, it } from "vitest";
import { addressSpaceHint, defaultAiSettings, normalizeAiSettings, normalizeBaseUrl } from "./providers";
import { keyHint } from "./keys";
import { buildMessages, chatTitle, fitText } from "./context";
import { localAdvice } from "./diagnostics";

describe("settings", () => {
  it("defaults to OpenRouter and keeps each provider's own address and model", () => {
    const s = normalizeAiSettings({
      provider: "local",
      providers: { local: { baseUrl: "http://localhost:1234/v1", model: "qwen" }, openrouter: { baseUrl: "", model: "x/y" } },
    });
    expect(s.provider).toBe("local");
    expect(s.providers.local).toEqual({ baseUrl: "http://localhost:1234/v1", model: "qwen" });
    expect(s.providers.openrouter).toEqual({ baseUrl: "https://openrouter.ai/api/v1", model: "x/y" });
    expect(normalizeAiSettings({ provider: "evil" })).toEqual(defaultAiSettings());
    expect(normalizeAiSettings("junk")).toEqual(defaultAiSettings());
  });

  it("normalizes base URLs", () => {
    expect(normalizeBaseUrl(" http://localhost:11434/v1/ ")).toBe("http://localhost:11434/v1");
    expect(normalizeBaseUrl("javascript:alert(1)")).toBe("");
    expect(normalizeBaseUrl("not a url")).toBe("");
  });

  it("marks local addresses for Chrome's local network permission", () => {
    expect(addressSpaceHint("http://localhost:11434/v1")).toEqual({ targetAddressSpace: "loopback" });
    expect(addressSpaceHint("http://127.0.0.1:1234")).toEqual({ targetAddressSpace: "loopback" });
    expect(addressSpaceHint("http://192.168.1.20:11434")).toEqual({ targetAddressSpace: "local" });
    expect(addressSpaceHint("http://studio.local:11434")).toEqual({ targetAddressSpace: "local" });
    expect(addressSpaceHint("https://openrouter.ai/api/v1")).toEqual({});
    expect(addressSpaceHint("http://172.32.0.1")).toEqual({});
  });
});

describe("keyHint", () => {
  it("spots keys from the wrong provider", () => {
    expect(keyHint("openrouter", "sk-ant-abc")).toContain("Anthropic");
    expect(keyHint("openrouter", "sk-proj-abc")).toContain("OpenAI");
    expect(keyHint("openrouter", "sk-or-v1-short")).toContain("cut short");
    expect(keyHint("openrouter", "sk-or-v1-" + "a".repeat(40))).toBeNull();
    expect(keyHint("custom", "anything")).toBeNull();
  });
});

describe("context", () => {
  it("sends instructions, the open note, then the conversation", () => {
    const m = buildMessages([{ role: "user", content: "Summarise" }], { path: "Ideas.md", text: "# Ideas\nA" });
    expect(m.map((x) => x.role)).toEqual(["system", "system", "user"]);
    expect(m[1].content).toContain('<note path="Ideas.md">\n# Ideas\nA\n</note>');
    expect(buildMessages([], null)).toHaveLength(1);
  });

  it("cuts long notes at a line break", () => {
    const long = ("line\n").repeat(10_000);
    const { text, cut } = fitText(long, 1000);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThan(1100);
    expect(text).toContain("left out");
    expect(fitText("short").cut).toBe(false);
  });

  it("titles a chat from its first line", () => {
    expect(chatTitle("What is [[X]]?\nmore")).toBe("What is X");
    expect(chatTitle("   ")).toBe("Chat");
  });
});

describe("localAdvice", () => {
  it("tells you how to allow this site in Ollama", () => {
    const a = localAdvice({ state: "origin-blocked" }, "https://notes.example");
    expect(a.steps.join(" ")).toContain('OLLAMA_ORIGINS="https://notes.example"');
    expect(localAdvice({ state: "ready", models: [{ id: "a", name: "a" }] }, "").title).toContain("1 model");
  });
});
