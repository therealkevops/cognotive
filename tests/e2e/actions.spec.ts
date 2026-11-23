import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";
import { editor, GOOD_KEY } from "./helpers";

const chat = (page: Page) => page.getByRole("region", { name: "Chat" });

async function setUp(page: Page, llm: FakeLLM, { key = true } = {}) {
  await llm.install(page);
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  if (!key) return;
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  const ai = page.getByRole("region", { name: "AI" });
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  await expect(ai.getByRole("listbox", { name: "Models" }).getByRole("option", { selected: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
}

async function palette(page: Page, command: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+p");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox").fill(command);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

const lastUser = (llm: FakeLLM) => [...llm.calls.at(-1)!.messages].reverse().find((m) => m.role === "user")!.content;

test("summarise a note from the palette, and save the summary as a property", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  llm.script = [
    { text: "- Notes live in the browser\n- Links connect them", calls: [{ name: "set_property", args: { path: "Welcome", key: "summary", value: "How Cognotive.ai works." } }] },
    "- Notes live in the browser\n- Links connect them",
  ];
  // The chat opens on its own, showing the short question.
  await palette(page, "AI: Summarise this note");
  await expect(chat(page).locator('[data-role="user"]')).toHaveText("Summarise Welcome");
  await expect(chat(page).locator('[data-role="assistant"]').last()).toContainText("Links connect them");
  // The model got the full instructions and the note.
  expect(lastUser(llm)).toContain("`summary` property");
  expect(llm.calls[0].messages.some((m) => m.content.includes('<note path="Welcome.md">'))).toBe(true);
  const change = chat(page).getByRole("listitem", { name: "Set summary of Welcome to How Cognotive.ai works." });
  await change.getByRole("button", { name: "Apply" }).click();
  await expect(change).toContainText("Applied");
  await expect(editor(page)).toContainText("summary: How Cognotive.ai works.");
});

test("Connections suggests links; the empty chat offers a weekly review", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("tab", { name: "Chat" }).click();
  await chat(page).getByRole("button", { name: "What did I work on this week?" }).click();
  await expect(chat(page).locator('[data-role="assistant"]').last()).toContainText("You asked");
  expect(lastUser(llm)).toContain("Notes changed in the last 7 days");
  expect(lastUser(llm)).toContain("- Welcome.md");

  await page.getByRole("tab", { name: "Connections" }).click();
  await page.getByRole("button", { name: "Suggest links with AI" }).click();
  await expect(chat(page).locator('[data-role="user"]').last()).toHaveText("Suggest links for Welcome");
  await expect.poll(() => lastUser(llm)).toContain('Find notes that "Welcome.md" should link to');
});

test("Repository health finds homes for orphans with AI", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  // A new note: nothing links to it yet.
  await expect(page.getByRole("tree", { name: "Repository files" }).getByRole("treeitem", { name: "Untitled" })).toBeVisible();
  await page.getByRole("button", { name: "Repository health" }).click();
  const dialog = page.getByRole("dialog", { name: "Repository health" });
  await dialog.getByRole("tab", { name: /Orphans/ }).click();
  await dialog.getByRole("button", { name: "Find homes with AI" }).click();
  await expect(dialog).toBeHidden();
  await expect(chat(page).locator('[data-role="user"]')).toHaveText(/^Find homes for \d+ orphan notes?$/);
  await expect.poll(() => lastUser(llm)).toContain("- Untitled.md");
});

test("the Properties panel suggests tags and properties with AI", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await editor(page).press("ControlOrMeta+Home");
  await page.keyboard.type("---\nstatus: draft\n---\n");
  await page.getByRole("tab", { name: "Properties" }).click();
  const props = page.getByRole("region", { name: "Properties" });
  await expect(props.getByRole("button", { name: "Suggest for Welcome with AI" })).toBeVisible();
  await props.getByRole("button", { name: "Suggest for Welcome with AI" }).click();
  await expect(chat(page).locator('[data-role="user"]').last()).toHaveText("Suggest tags and properties for Welcome");
  await expect.poll(() => lastUser(llm)).toContain("find_by_tag and find_by_property with no arguments");
});

test("an action without AI set up says what's missing", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm, { key: false });
  await palette(page, "AI: What did I work on this week?");
  await expect(chat(page).getByRole("alert")).toContainText("Add your OpenRouter API key");
  expect(llm.calls).toHaveLength(0);
});

test("the property table fills empty values with AI", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await editor(page).press("ControlOrMeta+Home");
  await page.keyboard.type("---\nstatus: draft\n---\n");
  await page.getByRole("tab", { name: "Properties" }).click();
  const props = page.getByRole("region", { name: "Properties" });
  await props.getByRole("button", { name: /^status/ }).click();
  await props.getByRole("button", { name: "Edit as table" }).click();
  const table = page.getByRole("dialog", { name: "Edit properties" });
  await table.getByLabel("Add a property column").fill("topic");
  await table.getByRole("button", { name: "Add" }).click();
  await table.getByRole("button", { name: "Fill empty topic with AI" }).click();
  await expect(table).toBeHidden();
  await expect(chat(page).locator('[data-role="user"]').last()).toHaveText("Fill in topic for 1 file");
  await expect.poll(() => lastUser(llm)).toContain('find_by_property with key "topic"');
});
