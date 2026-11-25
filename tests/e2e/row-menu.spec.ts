import { expect, test } from "@playwright/test";
import { editor, openApp, title, tree, treeAction } from "./helpers";

const menu = (page: import("@playwright/test").Page, item: string) => page.getByRole("menu", { name: `More actions for ${item}` });

test("a file's three-dot menu offers its actions, by mouse or keyboard", async ({ page }) => {
  await openApp(page);
  const row = tree(page).getByRole("treeitem", { name: "Linking notes" });
  const more = page.getByRole("button", { name: "More actions for Linking notes" });

  // The button appears on hover; its menu lists the actions in words.
  await row.hover();
  await more.click();
  await expect(menu(page, "Linking notes").getByRole("menuitem")).toHaveText([
    "Open in side pane",
    "Rename",
    "Move to…",
    "Select",
    "Select all",
    "Duplicate",
    "Copy link",
    "Pin to sidebar",
    "Delete",
  ]);
  // Escape closes it and returns to the button.
  await page.keyboard.press("Escape");
  await expect(menu(page, "Linking notes")).toBeHidden();
  await expect(more).toBeFocused();

  // By keyboard: open, move down, choose Rename.
  await page.keyboard.press("Enter");
  await expect(menu(page, "Linking notes").getByRole("menuitem", { name: "Open in side pane" })).toBeFocused();
  await page.keyboard.press("ArrowDown"); // Rename
  await page.keyboard.press("Enter");
  const input = tree(page).getByRole("textbox");
  await expect(input).toBeVisible();
  await input.fill("Links guide");
  await input.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: "Links guide" })).toBeVisible();

  // Clicking elsewhere closes it, without opening the note.
  await tree(page).getByRole("treeitem", { name: "Links guide" }).hover();
  await page.getByRole("button", { name: "More actions for Links guide" }).click();
  await page.mouse.click(700, 400);
  await expect(menu(page, "Links guide")).toBeHidden();
  await expect(title(page)).toHaveValue("Welcome");
});

test("right-clicking a file or folder opens the same menu", async ({ page }) => {
  await openApp(page);
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click({ button: "right" });
  await expect(menu(page, "Welcome").getByRole("menuitem").last()).toHaveText("Delete");
  await menu(page, "Welcome").getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete file" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");
  await tree(page).getByRole("treeitem", { name: "Work" }).click({ button: "right" });
  await expect(menu(page, "Work").getByRole("menuitem")).toHaveText([
    "New note here",
    "New drawing here",
    "New canvas here",
    "New folder here",
    "Upload files here",
    "Rename",
    "Move to…",
    "Select",
    "Select all",
    "Delete",
  ]);
  await menu(page, "Work").getByRole("menuitem", { name: "New note here" }).click();
  await expect(title(page)).toHaveValue("Untitled");
});

test("move, duplicate, copy a link and pin from a note's menu", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Guides");
  await name.press("Enter");

  // Move to a folder, chosen from a list.
  await treeAction(page, "Linking notes", "Move to…");
  const picker = page.getByRole("dialog", { name: "Move Linking notes.md to…" });
  await picker.getByRole("combobox").fill("Gui");
  await page.keyboard.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: "Guides" })).toHaveAttribute("aria-expanded", "true");
  await expect(tree(page).getByRole("treeitem", { name: "Linking notes" })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: "Linking notes" })).toHaveAttribute("aria-level", "2");

  // Duplicate: a copy alongside, opened.
  await treeAction(page, "Welcome", "Duplicate");
  await expect(title(page)).toHaveValue("Welcome copy");
  await expect(editor(page)).toContainText("Welcome to");

  // Copy link: in the repository's link format, ready to paste.
  await treeAction(page, "Linking notes", "Copy link");
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toContainText("[[Linking notes]]");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("[[Linking notes]]");

  // Pin to the sidebar as a hub, and unpin.
  await treeAction(page, "Linking notes", "Pin to sidebar");
  const hubs = page.getByRole("region", { name: "Hubs", exact: true });
  await expect(hubs.getByRole("button", { name: "Linking notes", exact: true })).toBeVisible();
  await treeAction(page, "Linking notes", "Unpin from sidebar");
  await expect(hubs.getByRole("button", { name: "Linking notes", exact: true })).toHaveCount(0);
});

test("a folder's menu makes drawings, canvases and folders in it, and uploads into it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");

  await treeAction(page, "Work", "New drawing here");
  await expect(title(page)).toHaveValue("Drawing");
  await expect(tree(page).getByRole("treeitem", { name: "Drawing" })).toHaveAttribute("aria-level", "2");

  const chooser = page.waitForEvent("filechooser");
  await treeAction(page, "Work", "Upload files here");
  await (await chooser).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(tree(page).getByRole("treeitem", { name: "notes.txt" })).toHaveAttribute("aria-level", "2");

  await treeAction(page, "Work", "New folder here");
  const sub = page.getByRole("textbox", { name: "New name" });
  await sub.fill("Archive");
  await sub.press("Enter");
  await expect(tree(page).getByRole("treeitem", { name: "Archive" })).toHaveAttribute("aria-level", "2");
});
