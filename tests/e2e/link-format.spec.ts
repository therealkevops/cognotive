import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });
const selected = (page: Page) => page.locator(".cm-tooltip-autocomplete [aria-selected=true]");

async function openApp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
}

async function palette(page: Page, command: string) {
  await page.keyboard.press("ControlOrMeta+p");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox").fill(command);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

async function useMarkdownLinks(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "This vault" }).click();
  const section = page.getByRole("region", { name: "This vault" });
  // Settings save as soon as they change.
  await section.getByLabel("New links use").selectOption("markdown");
  await expect(section.getByLabel("New links use")).toHaveValue("markdown");
  await page.keyboard.press("Escape");
}

test("with markdown links on, picked links are written as relative markdown links", async ({ page }) => {
  await openApp(page);
  await useMarkdownLinks(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");
  await tree(page).getByRole("treeitem", { name: "Work" }).hover();
  await page.getByRole("button", { name: "New note in Work" }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).click();

  await page.keyboard.type("Read [[Linking");
  await expect(selected(page)).toContainText("Linking notes");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await expect(editor(page)).toHaveText("Read [Linking notes](../Linking%20notes.md)");

  // It still works as a link in the app.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Alt+Enter");
  await expect(title(page)).toHaveValue("Linking notes");
});

test("the palette converts a note's links between the two formats", async ({ page }) => {
  await openApp(page);
  await page.getByRole("radio", { name: "Source" }).click();
  await palette(page, "Convert links in this note to markdown");
  await expect(editor(page)).toContainText("Next, read [Linking notes](Linking%20notes.md).");
  await expect(editor(page)).not.toContainText("[[Linking notes]]");
  // Renaming the target rewrites the markdown link too.
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await expect(title(page)).toHaveValue("Linking notes");
  await title(page).fill("How links work");
  await title(page).press("Enter");
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await expect(editor(page)).toContainText("[Linking notes](How%20links%20work.md)");

  await palette(page, "Convert links in this note to wikilinks");
  await expect(editor(page)).toContainText("Next, read [[How links work|Linking notes]].");
});
