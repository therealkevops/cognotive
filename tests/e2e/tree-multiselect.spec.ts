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
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await item(page, "Linking notes").getByRole("button", { name: "More actions for Linking notes" }).click();
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
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

test("several chosen files are renamed by one rule, with the new names shown first, and links follow", async ({ page }) => {
  await openApp(page);
  await item(page, "Welcome").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await page.getByRole("toolbar", { name: "Chosen files" }).getByRole("button", { name: "Rename selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename 2 items" });

  // A clash is named, and nothing can be renamed until it's gone.
  await dialog.getByLabel("Find").fill("Welcome");
  await dialog.getByLabel("Replace with").fill("Linking notes");
  const names = dialog.getByRole("list", { name: "New names" });
  await expect(names).toContainText("Another file would get this name.");
  await expect(dialog.getByRole("button", { name: /^Rename/ })).toBeDisabled();

  // Text before the names: each shown, then done.
  await dialog.getByRole("radio", { name: "Add text" }).click();
  await dialog.getByLabel("Before the name").fill("Old ");
  await expect(names).toContainText("Linking notes");
  await expect(names).toContainText("Old Linking notes");
  await expect(names).toContainText("Old Welcome");
  await dialog.getByRole("button", { name: "Rename 2" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Renamed 2 items." })).toBeVisible();
  await expect(item(page, "Old Welcome")).toBeVisible();
  await expect(item(page, "Old Linking notes")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Chosen files" })).toBeHidden();

  // Welcome's link to Linking notes follows it.
  await item(page, "Old Welcome").click();
  await expect(page.getByRole("region", { name: "Outgoing links" }).getByRole("button", { name: "Old Linking notes" })).toBeVisible();
});

test("numbering chosen files in the order shown, drawings keeping their kind", async ({ page }) => {
  await openApp(page);
  // An Obsidian-style drawing (.excalidraw.md) among them.
  const { strToU8, zipSync } = await import("fflate");
  const drawing = "---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n%%\n## Drawing\n```json\n{\"type\":\"excalidraw\",\"elements\":[]}\n```\n%%";
  const zip = zipSync({ "V/Sketch.excalidraw.md": strToU8(drawing) });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(item(page, "Sketch")).toBeVisible();

  // Rows: Linking notes, Sketch, Welcome.
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Welcome").click({ modifiers: ["Shift"] });
  await page.getByRole("toolbar", { name: "Chosen files" }).getByRole("button", { name: "Rename selected" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename 3 items" });
  await dialog.getByRole("radio", { name: "Number" }).click();
  await dialog.getByLabel("Name", { exact: true }).fill("Page");
  await dialog.getByRole("button", { name: "Rename 3" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Renamed 3 items." })).toBeVisible();
  for (const n of ["Page 1", "Page 2", "Page 3"]) await expect(item(page, n)).toBeVisible();

  // The drawing is still a drawing.
  await item(page, "Page 2").click();
  await expect(page.getByTestId("drawing")).toBeVisible({ timeout: 30_000 });
});

test("chosen files are copied to a folder, or duplicated where they are", async ({ page }) => {
  await openApp(page);
  await newFolder(page, "Archive");
  const bar = page.getByRole("toolbar", { name: "Chosen files" });

  await item(page, "Welcome").click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Linking notes").click({ modifiers: ["ControlOrMeta"] });
  await bar.getByRole("button", { name: "Copy selected" }).click();
  await page.getByRole("dialog", { name: "Copy 2 items to…" }).getByRole("combobox").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Copied 2 items to Archive." })).toBeVisible();
  // Copies in the folder, and the originals where they were.
  const archived = tree(page).getByRole("group");
  await expect(archived.getByRole("treeitem", { name: /^Welcome More/ })).toBeVisible();
  await expect(archived.getByRole("treeitem", { name: /^Linking notes More/ })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: /^Welcome More/ })).toHaveCount(2);
  await expect(bar).toBeHidden();

  // Copying them where they are makes duplicates, from a chosen row's menu.
  await item(page, "Welcome").first().click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Linking notes").first().click({ modifiers: ["ControlOrMeta"] });
  await item(page, "Welcome").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy 2 items to…" }).click();
  await page.getByRole("dialog", { name: "Copy 2 items to…" }).getByRole("combobox").fill("Top level");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Copied 2 items to the top level." })).toBeVisible();
  await expect(item(page, "Welcome copy")).toBeVisible();
  await expect(item(page, "Linking notes copy")).toBeVisible();

  // A copy has the note's text.
  await item(page, "Welcome copy").click();
  await expect(page.locator(".cm-content")).toContainText("Welcome to Cognotive.ai");
});

test("select all: Ctrl/Cmd+A in the tree, the bar's button, or a row's menu", async ({ page }) => {
  await openApp(page);
  await newFolder(page, "Box");
  const bar = page.getByRole("toolbar", { name: "Chosen files" });

  // The keyboard, while the tree has it: every row shown (Box, Linking notes, Welcome).
  await item(page, "Welcome").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(bar).toContainText("3 selected");
  for (const n of ["Box", "Linking notes", "Welcome"]) await expect(item(page, n)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();

  // From a row's menu, then the bar's button after narrowing it down.
  await item(page, "Box").getByRole("button", { name: "More actions for Box" }).click();
  await page.getByRole("menuitem", { name: "Select all" }).click();
  await expect(bar).toContainText("3 selected");
  await item(page, "Box").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Select all" }).click();
  await expect(bar).toContainText("3 selected");

  // Ctrl/Cmd+A in the note still selects its text, not files.
  await bar.getByRole("button", { name: "Clear selection" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(bar).toBeHidden();
});
