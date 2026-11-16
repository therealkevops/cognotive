import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });

async function openApp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
}

test("a note created from a link goes in the linking note's folder", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");
  const folder = tree(page).getByRole("treeitem", { name: "Work" });
  await folder.hover();
  await page.getByRole("button", { name: "New note in Work" }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
  await page.keyboard.type("Next: [[Roadmap]]");
  await page.keyboard.press("Alt+Enter");

  const dialog = page.getByRole("dialog", { name: "Create note" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Roadmap");
  await expect(dialog.getByLabel("Folder")).toHaveValue("Work");
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveValue("Roadmap");
  await expect(tree(page).getByRole("treeitem", { name: "Roadmap" })).toHaveAttribute("aria-level", "2");
});

test("cancelling the prompt creates nothing", async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n[[Scratch]]");
  await page.keyboard.press("Alt+Enter");
  await page.getByRole("dialog", { name: "Create note" }).getByRole("button", { name: "Cancel" }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await expect(tree(page).getByRole("treeitem", { name: "Scratch" })).toHaveCount(0);
});

test("Vault health lists broken links, orphans and hubs, and creates missing notes", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Vault health" }).click();
  const dialog = page.getByRole("dialog", { name: "Vault health" });
  const list = dialog.getByRole("tabpanel");
  await expect(list).toContainText("Ideas");
  await expect(list).toContainText("Linked from Linking notes");

  await dialog.getByRole("tab", { name: /Hubs/ }).click();
  await expect(dialog.getByRole("tabpanel", { name: "Hubs" })).toContainText("Nothing here");
  await dialog.getByRole("tab", { name: /Broken links/ }).click();
  await dialog.getByRole("button", { name: "Create Ideas" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("dialog", { name: "Create note" }).getByRole("button", { name: "Create" }).click();
  await expect(title(page)).toHaveValue("Ideas");

  // The new note is linked from Linking notes, but doesn't link anywhere itself: a dead end.
  await page.getByRole("button", { name: "Vault health" }).click();
  await dialog.getByRole("tab", { name: /Dead ends/ }).click();
  await expect(dialog.getByRole("tabpanel", { name: "Dead ends" }).getByRole("button", { name: "Ideas" })).toBeVisible();
  await dialog.getByRole("tabpanel", { name: "Dead ends" }).getByRole("button", { name: "Ideas" }).click();
  await expect(dialog).toBeHidden();
});

test("deleting a linked note warns, and can turn the links into text", async ({ page }) => {
  await openApp(page);
  const item = tree(page).getByRole("treeitem", { name: "Linking notes" });
  await item.hover();
  await page.getByRole("button", { name: "Delete Linking notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete file" });
  await expect(dialog).toContainText("1 note links here");
  await expect(dialog).toContainText("Welcome");
  await dialog.getByLabel("Turn the links into plain text").check();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(item).toBeHidden();

  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText("Next, read Linking notes.");
  await expect(editor(page)).not.toContainText("[[Linking notes]]");
});
