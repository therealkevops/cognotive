import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";
import { acceptSuggestion, editor, GOOD_KEY } from "./helpers";

const menu = (page: Page) => page.locator(".cm-tooltip-autocomplete");
const lastUser = (llm: FakeLLM) => [...llm.calls.at(-1)!.messages].reverse().find((m) => m.role === "user")!.content;

async function newLine(page: Page) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
}

test("the AI commands appear once AI is set up", async ({ page }) => {
  const llm = new FakeLLM();
  await llm.install(page);
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  await newLine(page);
  await page.keyboard.type("/summ");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  const ai = page.getByRole("region", { name: "AI" });
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  await expect(ai.getByRole("listbox", { name: "Models" }).getByRole("option", { selected: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();

  // /ask with a question: the Ask dialog opens on the paragraph and asks straight away.
  await newLine(page);
  await page.keyboard.type("Tomatoes need full sun and deep watering.");
  llm.script = ["They need about eight hours of sun a day."];
  await page.keyboard.type(" /ask how much sun");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Ask: How much sun");
  await acceptSuggestion(page);
  const dialog = page.getByRole("dialog", { name: "Ask about the selection" });
  await expect(dialog.getByLabel("Selection")).toHaveText("Tomatoes need full sun and deep watering.");
  await expect(dialog).toContainText("eight hours of sun");
  expect(lastUser(llm)).toContain("> Tomatoes need full sun and deep watering.");
  expect(lastUser(llm)).toContain("how much sun");
  await page.keyboard.press("Escape");
  await expect(editor(page).locator(".cm-line", { hasText: "Tomatoes" })).toHaveText("Tomatoes need full sun and deep watering. ");

  // /summarise: the chat opens with the summary.
  llm.script = ["- Notes live in the browser\n- Tomatoes need sun"];
  await editor(page).locator(".cm-line", { hasText: "Tomatoes" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/summ");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Summarise this note");
  await acceptSuggestion(page);
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat).toContainText("Summarise Welcome");
  await expect(chat).toContainText("Tomatoes need sun");
});
