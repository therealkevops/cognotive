import { expect, test } from "@playwright/test";
import { openApp, title, tree } from "./helpers";

const menu = (page: import("@playwright/test").Page, item: string) => page.getByRole("menu", { name: `More actions for ${item}` });

test("a file's three-dot menu offers its actions, by mouse or keyboard", async ({ page }) => {
  await openApp(page);
  const row = tree(page).getByRole("treeitem", { name: "Linking notes" });
  const more = page.getByRole("button", { name: "More actions for Linking notes" });

  // The button appears on hover; its menu lists the actions in words.
  await row.hover();
  await more.click();
  await expect(menu(page, "Linking notes").getByRole("menuitem")).toHaveText(["Open in side pane", "Rename", "Delete"]);
  // Escape closes it and returns to the button.
  await page.keyboard.press("Escape");
  await expect(menu(page, "Linking notes")).toBeHidden();
  await expect(more).toBeFocused();

  // By keyboard: open, move down, choose Rename.
  await page.keyboard.press("Enter");
  await expect(menu(page, "Linking notes").getByRole("menuitem", { name: "Open in side pane" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
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
  await expect(menu(page, "Welcome").getByRole("menuitem")).toHaveText(["Open in side pane", "Rename", "Delete"]);
  await menu(page, "Welcome").getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete file" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");
  await tree(page).getByRole("treeitem", { name: "Work" }).click({ button: "right" });
  await expect(menu(page, "Work").getByRole("menuitem")).toHaveText(["New note here", "Rename", "Delete"]);
  await menu(page, "Work").getByRole("menuitem", { name: "New note here" }).click();
  await expect(title(page)).toHaveValue("Untitled");
});
