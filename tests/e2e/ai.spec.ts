import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";

const GOOD_KEY = "sk-or-v1-good-key-0123456789abcdefghij";

async function openAiSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  return page.getByRole("region", { name: "AI" });
}

async function openChat(page: Page) {
  await page.getByRole("tab", { name: "Chat" }).click();
  return page.getByRole("region", { name: "Chat" });
}

test("set up OpenRouter, then chat about the open note", async ({ page }) => {
  const llm = new FakeLLM();
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();

  // Before setup, the chat says what's missing.
  let chat = await openChat(page);
  await expect(chat).toContainText("Add your OpenRouter API key");
  await chat.getByRole("button", { name: "Open AI settings" }).click();

  const ai = page.getByRole("region", { name: "AI" });
  await expect(ai.getByRole("radio", { name: /OpenRouter/ })).toHaveAttribute("aria-checked", "true");
  // A key from the wrong provider is spotted; a bad key is refused.
  const key = ai.getByLabel("API key");
  await key.fill("sk-ant-api03-something");
  await expect(ai).toContainText("looks like an Anthropic key");
  await key.fill("sk-or-v1-wrong-key-0123456789abcdefghij");
  await ai.getByRole("button", { name: "Save key" }).click();
  await expect(ai.getByRole("status").filter({ hasText: "refused" })).toBeVisible();
  await ai.getByRole("button", { name: "Remove key" }).click();
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  await expect(ai.getByRole("status").filter({ hasText: "Key works" })).toContainText("Used $0.42 of $5.00");

  // The catalog: searchable, with prices; a good default is chosen.
  const models = ai.getByRole("listbox", { name: "Models" });
  await expect(models.getByRole("option", { name: /Claude Sonnet 4.5/ })).toHaveAttribute("aria-selected", "true");
  await expect(models.getByRole("option", { name: /Llama 3.3 8B/ })).toContainText("no tools");
  await ai.getByPlaceholder(/Search 74 models/).fill("gpt");
  await expect(models.getByRole("option")).toHaveCount(1);
  await models.getByRole("option", { name: /GPT-5/ }).click();
  await expect(ai).toContainText("Using OpenAI: GPT-5");
  await page.getByRole("button", { name: "Close settings" }).click();

  // Chat about Welcome (open by default).
  chat = page.getByRole("region", { name: "Chat" });
  await expect(chat).toContainText("OpenRouter · openai/gpt-5");
  await expect(chat.getByRole("button", { name: "Welcome", pressed: true })).toBeVisible();
  await chat.getByLabel("Message").fill("Summarise this");
  await chat.getByLabel("Message").press("Enter");
  const answer = chat.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("You asked Summarise this. I read Welcome.");
  await expect(answer.locator("strong")).toHaveText("Summarise this");
  expect(llm.calls).toHaveLength(1);
  expect(llm.calls[0].model).toBe("openai/gpt-5");
  expect(llm.calls[0].auth).toBe(`Bearer ${GOOD_KEY}`);
  expect(llm.calls[0].headers["x-title"]).toBe("noted-ai");

  // A follow-up without the note; the conversation goes with it.
  await chat.getByRole("button", { name: "Welcome" }).click();
  await chat.getByLabel("Message").fill("And then?");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("No note was sent.");
  // The note's text isn't sent, only that it's open (so the agent can read it if asked).
  expect(llm.calls[1].messages.map((m) => m.role)).toEqual(["system", "system", "user", "assistant", "user"]);
  expect(JSON.stringify(llm.calls[1].messages)).not.toContain("<note path=");

  // Links in answers open notes.
  await chat.getByLabel("Message").fill("Link me");
  llm.reply = () => "See [[Linking notes]].";
  await chat.getByLabel("Message").press("Enter");
  await chat.locator('[data-role="assistant"]').last().getByRole("link", { name: "Linking notes" }).click();
  await expect(page.locator(".cm-content")).toContainText("Type [[ to link another note");
  await expect(chat.getByRole("button", { name: "Linking notes" })).toBeVisible();

  // The conversation survives switching tabs; New chat clears it.
  await page.getByRole("tab", { name: "Outline" }).click();
  chat = await openChat(page);
  await expect(chat.locator('[data-role="user"]')).toHaveCount(3);
  await chat.getByRole("button", { name: "New chat" }).click();
  await expect(chat.locator('[data-role="user"]')).toHaveCount(0);
});

test("the model list leads with suggested and free models, and says when it's cut short", async ({ page }) => {
  const llm = new FakeLLM();
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const ai = await openAiSettings(page);
  const models = ai.getByRole("listbox", { name: "Models" });
  await expect(models.getByRole("group", { name: "Suggested" }).getByRole("option")).toHaveText([/Claude Sonnet 4.5/, /GPT-5/]);
  // Free models come next, even one whose name sorts last.
  await expect(models.getByRole("group", { name: "Free" }).getByRole("option")).toHaveText([/Llama 3.3 8B/, /Zeta: Zed/]);
  await expect(ai).toContainText("Showing 60 of 74.");
  await ai.getByRole("button", { name: "show all 74" }).click();
  await expect(models.getByRole("option")).toHaveCount(74);

  await ai.getByRole("button", { name: "Free 2" }).click();
  await expect(models.getByRole("option")).toHaveCount(2);
  await models.getByRole("option", { name: /Zeta: Zed/ }).click();
  await expect(ai.getByRole("note")).toContainText("Free models allow only a small number of requests a day");
  await ai.getByRole("button", { name: "With tools 73" }).click();
  await expect(models.getByRole("option", { name: /Llama 3.3 8B/ })).toHaveCount(0);
});

test("stop an answer, and recover from errors", async ({ page }) => {
  const llm = new FakeLLM();
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const ai = await openAiSettings(page);
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  await expect(ai.getByRole("listbox", { name: "Models" }).getByRole("option", { selected: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  const chat = await openChat(page);

  llm.hold();
  await chat.getByLabel("Message").fill("Take your time");
  await chat.getByLabel("Message").press("Enter");
  await expect(chat.getByText("Thinking…")).toBeVisible();
  await chat.getByRole("button", { name: "Stop" }).click();
  await expect(chat.getByText("Stopped.")).toBeVisible();
  llm.release();

  llm.failNext = { status: 429, body: { error: { message: "Rate limited" } } };
  await chat.getByRole("button", { name: "Try again" }).click();
  await expect(chat.getByRole("alert")).toContainText("Too many requests");
  await chat.getByRole("button", { name: "Try again" }).click();
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("You asked Take your time");
  await expect(chat.locator('[data-role="user"]')).toHaveCount(1);
});

test("a local model: diagnosis, models, and chat that stays on the machine", async ({ page }) => {
  const llm = new FakeLLM();
  llm.localBlocksOrigin = true;
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const ai = await openAiSettings(page);
  await ai.getByRole("radio", { name: /Local/ }).click();

  // Running, but not allowing this site: say how to fix it.
  const status = ai.getByRole("status", { name: "Local connection" });
  await expect(status).toContainText("doesn't accept requests from this site");
  await expect(status).toContainText(`OLLAMA_ORIGINS="http://localhost:`);
  llm.localBlocksOrigin = false;
  await ai.getByRole("button", { name: "Check again" }).click();
  await expect(status).toContainText("Connected. 2 models available.");
  await ai.getByLabel("Model", { exact: true }).selectOption("qwen3:8b");

  // LM Studio's address is one click away (and nothing answers there).
  await ai.getByRole("button", { name: "LM Studio" }).click();
  await expect(status).toContainText("Nothing answered");
  await ai.getByRole("button", { name: "Ollama" }).click();
  await expect(status).toContainText("Connected");
  await page.getByRole("button", { name: "Close settings" }).click();

  const chat = await openChat(page);
  await expect(chat).toContainText("Stays on this machine");
  await chat.getByLabel("Message").fill("Hello");
  await chat.getByLabel("Message").press("Enter");
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("I read Welcome");
  expect(llm.calls.map((c) => [c.host, c.model])).toEqual([["local", "qwen3:8b"]]);
  expect(llm.calls[0].auth).toBeUndefined();
});

test("a repository can keep its notes away from remote providers", async ({ page }) => {
  const llm = new FakeLLM();
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const ai = await openAiSettings(page);
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  await ai.getByLabel("Send notes to remote providers").selectOption("never");
  await expect(ai).toContainText("The chat will only use the Local provider.");
  await page.getByRole("button", { name: "Close settings" }).click();
  const chat = await openChat(page);
  await expect(chat).toContainText("only allows local models");
  await expect(chat.getByLabel("Message")).toBeDisabled();
  expect(llm.calls).toHaveLength(0);
});
