import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tabs = (page: Page) => page.getByRole("tablist", { name: "Open notes" });
const link = (page: Page) => editor(page).locator(".cm-wikilink", { hasText: "Linking notes" });

async function openWelcome(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await expect(title(page)).toHaveValue("Welcome");
  await expect(link(page)).toBeVisible();
}

test("a click edits a link, ↗ follows it in this tab, and Back/Forward retrace", async ({ page }) => {
  await openWelcome(page);
  // A plain click puts the cursor in the link instead of leaving the note.
  await link(page).click();
  await expect(title(page)).toHaveValue("Welcome");
  await expect(editor(page)).toContainText("[[Linking notes]]");

  await page.keyboard.press("End"); // move off the link, so it renders again
  await page.getByRole("button", { name: "Open Linking notes" }).click();
  await expect(title(page)).toHaveValue("Linking notes");
  // Followed in the same tab: Welcome's tab became Linking notes.
  await expect(tabs(page)).toBeHidden();

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(title(page)).toHaveValue("Linking notes");
  await page.keyboard.press("ControlOrMeta+Alt+ArrowLeft");
  await expect(title(page)).toHaveValue("Welcome");
});

test("Ctrl/Cmd-click opens a new tab and Ctrl/Cmd+Alt-click the side pane", async ({ page }) => {
  await openWelcome(page);
  await link(page).click({ modifiers: ["ControlOrMeta"] });
  await expect(title(page)).toHaveValue("Linking notes");
  await expect(tabs(page).getByRole("tab")).toHaveCount(2);

  await tabs(page).getByRole("tab", { name: /Welcome/ }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await link(page).click({ modifiers: ["ControlOrMeta", "Alt"] });
  const side = page.getByRole("region", { name: "Side pane" });
  await expect(side.getByRole("heading", { name: "Linking notes", level: 1 })).toBeVisible();
  await expect(title(page)).toHaveValue("Welcome");
});

test("Alt+Enter follows the link at the cursor, and a setting makes clicks follow", async ({ page }) => {
  await openWelcome(page);
  await link(page).click();
  await page.keyboard.press("Alt+Enter");
  await expect(title(page)).toHaveValue("Linking notes");

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Editor" }).click();
  await page
    .getByRole("region", { name: "Editor" })
    .getByLabel("Clicking a link in live preview")
    .selectOption("follow");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open Linking notes" })).toHaveCount(0);
  await link(page).click();
  await expect(title(page)).toHaveValue("Linking notes");
});

test("Back returns to where you were scrolled", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
  // A long note with a link at the bottom.
  await page.keyboard.insertText(`${Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join("\n")}\nSee [[Welcome]]`);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const scroller = page.locator(".cm-scroller");
  const top = await scroller.evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(500);

  await page.keyboard.press("Alt+Enter");
  await expect(title(page)).toHaveValue("Welcome");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(top - 50);
});
