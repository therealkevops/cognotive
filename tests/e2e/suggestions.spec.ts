import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Repository files" });
const suggestions = (page: Page) => page.locator(".cm-tooltip-autocomplete");

async function newNote(page: Page) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
}

test("suggestions offer a new note when nothing matches", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await newNote(page);
  await page.keyboard.type("[[Brand new");
  const option = suggestions(page).getByRole("option", { name: /Brand new.*New note/ });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText("[[Brand new]]");
});

test("recently opened notes come first", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await newNote(page);
  await page.keyboard.type("[[");
  // Alphabetically "Linking notes" would come first; Welcome was opened last.
  await expect(suggestions(page).getByRole("option").first()).toContainText("Welcome");
});

test("typing [[ around selected text makes it a link and suggests notes", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await newNote(page);
  await page.keyboard.type("Welc");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("[[");
  // The editor ignores Enter for a moment after suggestions open; wait for the highlighted one.
  await expect(suggestions(page).locator("[aria-selected=true]")).toContainText("Welcome");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText("[[Welcome]]");
});

test("Ctrl/Cmd+Shift+K links the selection to a chosen note", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await newNote(page);
  await page.keyboard.type("Read the guide first.");
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowRight"); // "the guide"
  await page.keyboard.press("ControlOrMeta+Shift+K");
  const picker = page.getByRole("dialog", { name: "Link selection to" });
  await picker.getByRole("combobox").fill("linking");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText("Read [[Linking notes|the guide]] first.");
});

test("dragging a note from the file tree into the editor links it", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await newNote(page);
  await page.keyboard.type("See ");
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).dragTo(editor(page));
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText("[[Linking notes]]");
});
