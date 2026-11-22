import { expect, test, type Page } from "@playwright/test";
import { acceptSuggestion, editor, title, tree } from "./helpers";

async function newNote(page: Page, name: string) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await title(page).fill(name);
  await title(page).press("Enter");
  await expect(tree(page).getByRole("treeitem", { name })).toBeVisible();
  await editor(page).click();
}

test("typing [[ suggests notes, and links can be followed", async ({ page }) => {
  await newNote(page, "Daily");
  await page.keyboard.type("Read [[Welc");
  await expect(page.locator(".cm-tooltip-autocomplete [aria-selected=true]")).toContainText("Welcome");
  await acceptSuggestion(page);
  await page.keyboard.type(" today.");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText("Read [[Welcome]] today.");

  // Ctrl/Cmd-click follows the link.
  await editor(page).locator(".cm-wikilink").click({ modifiers: ["ControlOrMeta"] });
  await expect(title(page)).toHaveValue("Welcome");

  // Welcome now shows the backlink.
  const backlinks = page.getByRole("region", { name: "Backlinks" });
  await expect(backlinks.getByRole("button", { name: "Daily" })).toBeVisible();
  await expect(backlinks).toContainText("Read [[Welcome]] today.");
});

test("clicking a link to a missing note creates it", async ({ page }) => {
  await newNote(page, "Plans");
  await page.keyboard.type("Next: [[Garden ideas]]\n");
  await page.getByRole("radio", { name: "Reading" }).click();
  const link = page.getByTestId("reading-view").locator("a.internal-link.unresolved");
  await expect(link).toHaveText("Garden ideas");
  await link.click();
  // It asks first, with the name and folder filled in.
  const dialog = page.getByRole("dialog", { name: "Create note" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Garden ideas");
  await expect(dialog.getByLabel("Folder")).toHaveValue("");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(title(page)).toHaveValue("Garden ideas");
  await expect(tree(page).getByRole("treeitem", { name: "Garden ideas" })).toBeVisible();
});

test("renaming a note updates links to it", async ({ page }) => {
  await page.goto("/");
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await expect(title(page)).toHaveValue("Linking notes");
  await title(page).fill("How links work");
  await title(page).press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: "How links work" })).toBeVisible();

  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText("Next, read [[How links work]].");
});

test("unlinked mentions can be turned into links", async ({ page }) => {
  await newNote(page, "Journal");
  await page.keyboard.type("Spent time on the welcome page.");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  const mentions = page.getByRole("region", { name: "Unlinked mentions" });
  await expect(mentions).toContainText("Spent time on the welcome page.");
  await mentions.getByRole("button", { name: "Link the mention in Journal" }).click();
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: "Journal" })).toBeVisible();

  await tree(page).getByRole("treeitem", { name: "Journal" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText("Spent time on the [[Welcome|welcome]] page.");
});

test("tags list their notes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Tags" }).click();
  await page.getByRole("region", { name: "Tags" }).getByRole("button", { name: /#guide/ }).click();
  await expect(page.getByRole("searchbox", { name: "Search all notes" })).toHaveValue("tag:guide");
  await expect(page.getByRole("region", { name: "Search" }).getByRole("button", { name: /Linking notes/ })).toBeVisible();
});

test("the Connections panel shows notes that share links", async ({ page }) => {
  await newNote(page, "Reading list");
  await page.keyboard.type("Start with [[Welcome]]");
  const shares = page.getByRole("region", { name: "Shares links with" });
  // Linking notes also links to Welcome, so the two are related.
  await expect(shares.getByRole("button", { name: "Linking notes" })).toBeVisible();
  await expect(shares).toContainText("Both connect to Welcome");
});

test("Map as canvas lays out a note and its connections", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Map as canvas" }).click();
  await expect(title(page)).toHaveValue("Welcome map");
  const board = page.getByTestId("canvas");
  await expect(board.locator(".react-flow__node", { hasText: "Welcome to noted-ai" })).toBeVisible();
  await expect(board.getByRole("button", { name: "Linking notes", exact: true })).toBeVisible(); // its card's title
  // Welcome and Linking notes link to each other: one arrow, both ways.
  await expect(board.locator(".react-flow__edge")).toHaveCount(1);
  await expect(tree(page).getByRole("treeitem", { name: "Welcome map" })).toBeVisible();
});
