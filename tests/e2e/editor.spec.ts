import { expect, test, type Page } from "@playwright/test";
import { editor, tree } from "./helpers";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle("Cognotive.ai");
  await expect(page.locator(".cm-content")).toBeVisible();
}

test("a new repository opens on the welcome note", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome");
  await expect(tree(page).getByRole("treeitem", { name: "Welcome" })).toBeVisible();
  await page.getByRole("tab", { name: "Outline" }).click();
  await expect(page.getByRole("region", { name: "Outline" })).toContainText("Formatting");
});

test("notes are created, formatted and kept across reloads", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Note title" });
  await expect(title).toHaveValue("Untitled");

  await title.fill("Groceries");
  await title.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: "Groceries" })).toBeVisible();

  await editor(page).click();
  await page.keyboard.type("Buy ");
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type("milk");
  await expect(editor(page)).toContainText("Buy **milk**");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Groceries");
  // Cursor is elsewhere after reload, so live preview hides the markers.
  await expect(editor(page)).toHaveText("Buy milk");
  await expect(editor(page).locator(".cm-line").first()).toContainText("milk");
});

test("the toolbar formats the selection", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await page.keyboard.type("Shopping");
  await page.keyboard.press(`${mod}+a`);
  await page.getByRole("button", { name: "Heading 2" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText("## Shopping");
});

test("reading view renders markdown", async ({ page }) => {
  await openApp(page);
  await page.getByRole("radio", { name: "Reading" }).click();
  const view = page.getByTestId("reading-view");
  await expect(view.getByRole("heading", { level: 1 })).toHaveText("Welcome to Cognotive.ai");
  await expect(view.locator("table")).toBeVisible();
  await expect(view.locator(".callout-tip")).toContainText("Live preview");
  await expect(view.locator(".katex").first()).toBeVisible();
  await expect(view.locator(".mermaid-diagram svg")).toBeVisible();
  // The choice of mode is remembered.
  await page.reload();
  await expect(page.getByTestId("reading-view")).toBeVisible();
});

test("the quick switcher opens and creates notes", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press(`${mod}+o`);
  const dialog = page.getByRole("dialog", { name: "Quick switcher" });
  await dialog.getByRole("combobox").fill("Project ideas");
  await expect(dialog.getByRole("option", { name: "Create “Project ideas”" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Project ideas");

  await page.keyboard.press(`${mod}+o`);
  await dialog.getByRole("combobox").fill("welc");
  await expect(dialog.getByRole("option").first()).toHaveText(/Welcome/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome");
});

test("search finds notes by their content", async ({ page }) => {
  await openApp(page);
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search all notes" }).fill("euler");
  const result = page.getByRole("region", { name: "Search" }).getByRole("button", { name: /Welcome/ });
  await expect(result).toBeVisible();
  await expect(result.locator("mark")).toHaveText(/euler/i);
});

test("folders hold notes, and deleting a folder removes them", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");
  const folder = tree(page).getByRole("treeitem", { name: "Work" });
  await expect(folder).toBeVisible();

  await folder.hover();
  await page.getByRole("button", { name: "New note in Work" }).click();
  await expect(tree(page).getByRole("treeitem", { name: "Untitled" })).toBeVisible();

  await folder.hover();
  await page.getByRole("button", { name: "Delete Work" }).click();
  await page.getByRole("dialog", { name: "Delete folder" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(folder).toBeHidden();
  await expect(tree(page).getByRole("treeitem", { name: "Untitled" })).toBeHidden();
  await expect(page.getByText("No note is open.")).toBeVisible();
});
