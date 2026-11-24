import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { editor, title, tree } from "./helpers";

/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

/** An Obsidian vault folder on disk, as a person would pick it. */
function makeVault(root: string): string {
  const vault = join(root, "Brain");
  const files: Record<string, string | Buffer> = {
    "Notes/Plan.md": "# Plan\nSee [[Ideas]] and ![[photo.png]]\n",
    "Ideas.md": "# Ideas\nGrow tomatoes.\n",
    "Attachments/photo.png": PNG,
    ".obsidian/app.json": JSON.stringify({ attachmentFolderPath: "Attachments", newFileLocation: "folder", newFileFolderPath: "Inbox" }),
    ".obsidian/daily-notes.json": JSON.stringify({ folder: "Journal", format: "YYYY-MM-DD" }),
    ".obsidian/workspace.json": "{}",
    ".obsidian/plugins/some-plugin/main.js": "console.log(1)",
    ".trash/Old.md": "# Old\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(vault, path)), { recursive: true });
    writeFileSync(join(vault, path), content);
  }
  return vault;
}

async function pickVault(page: Page, folder: string) {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  await expect(dialog.getByRole("button", { name: "Import an Obsidian vault" })).toBeVisible();
  await dialog.getByLabel("Choose an Obsidian vault folder").setInputFiles(folder);
  return dialog;
}

test("an Obsidian vault folder becomes a new repository, with its settings", async ({ page }, info) => {
  const folder = makeVault(info.outputPath("vault"));
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  const dialog = await pickVault(page, folder);

  const form = dialog.getByRole("form", { name: "Import an Obsidian vault" });
  await expect(form).toContainText("Import “Brain”");
  await expect(form).toContainText("2 notes, 0 drawings and canvases, 1 attachment");
  await expect(form).toContainText("With the vault's attachment folder, where new notes go, daily notes folder, daily note names.");
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Brain");
  await form.getByRole("button", { name: "Import 3 files" }).click();
  // The new repository opens, saying what came in.
  await expect(page.getByRole("status").filter({ hasText: "Imported 3 files from Obsidian into “Brain”." })).toBeVisible();

  // Its notes, not the welcome note, and none of Obsidian's own files.
  await expect(page.getByRole("button", { name: /Brain/ }).first()).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: "Ideas" })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: /^Attachments/ })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: /^Notes/ })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: "Welcome" })).toHaveCount(0);
  await expect(tree(page).getByRole("treeitem", { name: /Old|\.obsidian|\.trash/ })).toHaveCount(0);

  // Links work across it.
  await tree(page).getByRole("treeitem", { name: "Ideas" }).click();
  await expect(title(page)).toHaveValue("Ideas");
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: "Plan" })).toBeVisible();

  // And Obsidian's settings carried over.
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("button", { name: "This repository" }).click();
  await expect(dialog.getByLabel("Attachment folder")).toHaveValue("Attachments");
  await expect(dialog.getByLabel("Daily notes folder")).toHaveValue("Journal");
});

test("an Obsidian vault folder can go into the open repository instead", async ({ page }, info) => {
  const folder = makeVault(info.outputPath("vault"));
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  const dialog = await pickVault(page, folder);
  const form = dialog.getByRole("form", { name: "Import an Obsidian vault" });
  await form.getByRole("radio", { name: /This repository, “My notes”/ }).check();
  await expect(form.getByLabel("Name", { exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "Import 3 files" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Imported 3 files into “My notes”." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tree(page).getByRole("treeitem", { name: "Welcome" })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: "Ideas" })).toBeVisible();
});
