import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";
import { GOOD_KEY } from "./helpers";

async function setUp(page: Page, llm: FakeLLM, model?: RegExp) {
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  const ai = page.getByRole("region", { name: "AI" });
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  const models = ai.getByRole("listbox", { name: "Models" });
  await expect(models.getByRole("option", { selected: true })).toBeVisible();
  if (model) await models.getByRole("option", { name: model }).click();
  return ai;
}

async function ask(page: Page, question: string) {
  await page.getByRole("tab", { name: "Chat" }).click();
  const chat = page.getByRole("region", { name: "Chat" });
  await chat.getByLabel("Message").fill(question);
  await chat.getByLabel("Message").press("Enter");
  return chat;
}

test("the agent searches and reads notes, and shows what it read", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.script = [
    { text: "Let me look that up.", calls: [{ name: "search_notes", args: { query: "link" } }] },
    { calls: [{ name: "read_note", args: { path: "Linking notes", section: "Links" } }, { name: "get_links", args: { path: "Linking notes" } }] },
    { calls: [{ name: "read_note", args: { path: "Linking notes" } }] },
    "Type `[[` to link a note, as [[Linking notes]] explains.",
  ];
  const chat = await ask(page, "How do I link notes?");
  const answer = chat.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("as Linking notes explains");
  // The thinking-aloud text before the tool calls isn't part of the answer.
  await expect(answer).not.toContainText("Let me look that up");

  // Tools were offered, and their results went back to the model.
  expect(llm.calls).toHaveLength(4);
  expect(llm.calls[0].tools).toEqual(expect.arrayContaining(["search_notes", "read_note", "get_links", "list_hubs", "repository_health"]));
  const searched = llm.calls[1].messages.find((m) => m.role === "tool")!;
  expect(JSON.parse(searched.content).results.map((r: { path: string }) => r.path)).toContain("Linking notes.md");
  const full = llm.calls[3].messages.filter((m) => m.role === "tool").at(-1)!;
  expect(full.content).toContain("Path: Linking notes.md");

  // What it read: the open note (sent with the question) and the note it opened.
  await answer.getByText("Read 2 notes").click();
  const read = answer.getByRole("list", { name: "Notes read" });
  await expect(read.getByRole("button")).toHaveText(["Welcome", "Linking notes"]);
  await expect(answer.getByRole("list", { name: "Steps" })).toContainText("Searched “link”");
  await expect(answer.getByRole("list", { name: "Steps" })).toContainText("Followed links of Linking notes");
  await expect(answer).toContainText("4.0k tokens");

  // Citations and the read list open notes.
  await answer.getByRole("link", { name: "Linking notes" }).click();
  await expect(page.locator(".cm-content")).toContainText("Type [[ to link another note");
});

test("models without tools answer from search results", async ({ page }) => {
  const llm = new FakeLLM();
  // OpenRouter's catalog says this one can't use tools.
  await setUp(page, llm, /Llama 3.3 8B/);
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.reply = (call) => (call.messages.some((m) => m.content.includes('<note path="Linking notes.md"')) ? "See [[Linking notes]]." : "Nothing found.");
  const chat = await ask(page, "How does linking work?");
  const answer = chat.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("See Linking notes.");
  await expect(answer).toContainText("answered from search results");
  expect(llm.calls).toHaveLength(1);
  expect(llm.calls[0].tools).toEqual([]);
});

test("a local model that refuses tools falls back to search", async ({ page }) => {
  const llm = new FakeLLM();
  llm.localNoTools = true;
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  const ai = page.getByRole("region", { name: "AI" });
  await ai.getByRole("radio", { name: /Local/ }).click();
  await expect(ai.getByRole("status", { name: "Local connection" })).toContainText("Connected");
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.reply = () => "From your notes.";
  const chat = await ask(page, "What about links?");
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("answered from search results");
  expect(llm.calls.map((c) => c.tools.length > 0)).toEqual([true, false]);
});

test("with the agent off, the model only sees the open note", async ({ page }) => {
  const llm = new FakeLLM();
  const ai = await setUp(page, llm);
  await ai.getByRole("switch", { name: "Let the model search and read notes" }).click();
  await expect(ai.getByLabel("Most steps per question")).toBeHidden();
  await page.getByRole("button", { name: "Close settings" }).click();
  const chat = await ask(page, "Hi");
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("I read Welcome");
  expect(llm.calls[0].tools).toEqual([]);
});

test("the step limit stops a model that keeps looking", async ({ page }) => {
  const llm = new FakeLLM();
  const ai = await setUp(page, llm);
  await ai.getByLabel("Most steps per question").fill("2");
  await ai.getByLabel("Most steps per question").press("Enter");
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.reply = (call) => (call.tools.length ? { calls: [{ name: "list_hubs", args: {} }] } : "Best I could do.");
  const chat = await ask(page, "Keep going");
  const answer = chat.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("Best I could do.");
  await expect(answer).toContainText("Reached the step limit");
  expect(llm.calls).toHaveLength(3);
});
