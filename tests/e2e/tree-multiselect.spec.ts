import { expect, test, type Page } from "@playwright/test";
import { openApp, tree } from "./helpers";

const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name} More actions`) });

async function newFolder(page: Page, name: string) {
  await page.getByRole("button", { name: "New folder" }).click();
  const input = page.getByRole("textbox", { name: "New name" });
  await input.fill(name);
  await input.press("Enter");
  await expect(item(page, name)).toBeVisible();
}

test("Ctrl/Cmd-click chooses several files, and they move together", async ({ page }) => {
  await openApp(page);
  await newFolder(page, "Archive");

  await item(page, "Welcome").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("toolbar", { name: "Chosen files" });
  await expect(bar).toContainText("2 selected");
  await expect(item(page, "Welcome")).toHaveAttribute("aria-selected", "true");
  await expect(item(page, "Linking notes")).toHaveAttribute("aria-selected", "true");
  // Clicking a chosen one again lets it go.
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toContainText("1 selected");
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });

  await bar.getByRole("button", { name: "Move to…" }).click();
  const picker = page.getByRole("dialog", { name: "Move 2 items to…" });
  await picker.getByRole("combobox").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Moved 2 items to Archive." })).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(tree(page).getByRole("group").getByRole("treeitem", { name: /^Welcome More/ })).toBeVisible();
  await expect(tree(page).getByRole("group").getByRole("treeitem", { name: /^Linking notes More/ })).toBeVisible();
  // Links between them still work: they moved, not copied.
  await expect(tree(page).getByRole("treeitem", { name: /^(Welcome|Linking notes) More/ })).toHaveCount(2);
});

test("Shift-click chooses a range, which can be dragged onto a folder; Escape lets them go", async ({ page }) => {
  await openApp(page);
  await newFolder(page, "Box");
  // Rows: Box, Linking notes, Welcome. From the open note (Welcome) up to Box.
  await item(page, "Box").click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Chosen files" });
  await expect(bar).toContainText("3 selected");
  // Then from Linking notes down: a new range.
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Welcome").click({ modifiers: ["Shift"] });
  await expect(bar).toContainText("2 selected");

  await item(page, "Welcome").dragTo(item(page, "Box"));
  await expect(page.getByRole("status").filter({ hasText: "Moved 2 items to Box." })).toBeVisible();
  for (const name of ["Linking notes", "Welcome"]) {
    await expect(tree(page).getByRole("group").getByRole("treeitem", { name: new RegExp(`^${name} More`) })).toBeVisible();
  }

  // Escape, or a plain click, lets a selection go.
  await item(page, "Welcome").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toContainText("1 selected");
  await item(page, "Welcome").press("Escape");
  await expect(bar).toBeHidden();
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toContainText("1 selected");
  await item(page, "Welcome").click();
  await expect(bar).toBeHidden();
});

test("a chosen file's menu moves them all, and Select works without a keyboard", async ({ page }) => {
  await openApp(page);
  await newFolder(page, "Later");
  // Choosing from the menu (as on a touch screen).
  await item(page, "Welcome").getByRole("button", { name: "More actions for Welcome" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();
  await item(page, "Linking notes").getByRole("button", { name: "More actions for Linking notes" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();
  await expect(page.getByRole("toolbar", { name: "Chosen files" })).toContainText("2 selected");

  await item(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move 2 items to…" }).click();
  await page.getByRole("dialog", { name: "Move 2 items to…" }).getByRole("combobox").fill("Later");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Moved 2 items to Later." })).toBeVisible();
});

test("several chosen files are deleted together, after one confirmation", async ({ page }) => {
  await openApp(page);
  await newFolder(page, "Old");
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Old").click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("toolbar", { name: "Chosen files" });
  await expect(bar).toContainText("2 selected");

  // Cancelling keeps them chosen.
  await bar.getByRole("button", { name: "Delete selected" }).click();
  let dialog = page.getByRole("dialog", { name: "Delete 2 items" });
  await expect(dialog).toContainText("Delete these 2 items (a folder with everything in it)?");
  await expect(dialog.getByRole("list", { name: "To delete" })).toContainText("Linking notes.md");
  // Welcome links to Linking notes: the dialog says so.
  await expect(dialog).toContainText("1 note links to them");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(bar).toContainText("2 selected");

  // From a chosen row's menu, this time.
  await item(page, "Old").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete 2 items" }).click();
  dialog = page.getByRole("dialog", { name: "Delete 2 items" });
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(item(page, "Linking notes")).toHaveCount(0);
  await expect(item(page, "Old")).toHaveCount(0);
  await expect(item(page, "Welcome")).toBeVisible();
  await expect(bar).toBeHidden();
});
