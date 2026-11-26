import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";
import { editor, tree } from "./helpers";

async function openRepositories(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  return dialog;
}

test("a repository kept in this browser merges into one synced with GitHub, and goes up with the next sync", async ({ page }) => {
  const github = new FakeGitHub({ "Notes.md": "# Notes\n" });
  await github.install(page);
  await page.goto("/");
  await expect(editor(page)).toBeVisible();

  // Connect GitHub (it opens), keeping "My notes" (Welcome, Linking notes) in this browser.
  let dialog = await openRepositories(page);
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByLabel("GitHub token").fill("github_pat_test");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  await dialog.getByRole("button", { name: "Connect and open" }).click();
  await expect(tree(page).getByRole("treeitem", { name: "Notes" })).toBeVisible();
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  dialog = await openRepositories(page);
  await dialog.getByRole("button", { name: "Merge My notes into another repository" }).click();
  const form = dialog.getByRole("form", { name: "Merge My notes" });
  await expect(form.getByRole("combobox", { name: "Merge into" })).toHaveValue(/.+/);
  await expect(form.getByRole("combobox", { name: "Merge into" }).locator("option:checked")).toHaveText(/GitHub: me\/notes/);
  await expect(form.getByLabel("Folder name")).toHaveValue("My notes");
  await form.getByRole("checkbox", { name: /Then remove “My notes”/ }).check();
  await form.getByRole("button", { name: /^Merge into/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Merged “My notes” into" })).toContainText(
    "2 files added. They go to GitHub with its next sync.",
  );
  // "My notes" is gone from this browser.
  if (await dialog.isVisible()) {
    await expect(dialog.getByRole("button", { name: "Merge My notes into another repository" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  await tree(page).getByRole("treeitem", { name: /^My notes/ }).click();
  await expect(tree(page).getByRole("treeitem", { name: /^Welcome/ })).toBeVisible();
  // Synced (now, or already by itself).
  await page.getByRole("button", { name: /sync now/i }).click();
  await expect.poll(() => Object.keys(github.files()).sort()).toEqual(["My notes/Linking notes.md", "My notes/Welcome.md", "Notes.md"].sort());
  expect(github.files()["My notes/Welcome.md"]).toContain("# Welcome to Cognotive.ai");
});

test("merging into another repository at the top level opens it, keeping what's there", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  // A second repository with a note of the same name as one here, but different.
  let dialog = await openRepositories(page);
  await dialog.getByRole("button", { name: "New local repository" }).click();
  await dialog.getByRole("form", { name: "New local repository" }).getByLabel("Name").fill("Work");
  await dialog.getByRole("button", { name: "Create and open" }).click();
  await expect(tree(page).getByRole("treeitem", { name: /^Welcome/ })).toBeVisible();
  await tree(page).getByRole("treeitem", { name: /^Welcome/ }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nWork's own welcome.");
  await expect(editor(page)).toContainText("Work's own welcome.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

  // Merge "Work" into "My notes", at the top level.
  dialog = await openRepositories(page);
  await dialog.getByRole("button", { name: "Merge Work into another repository" }).click();
  const form = dialog.getByRole("form", { name: "Merge Work" });
  await form.getByRole("radio", { name: /At the top level/ }).check();
  await form.getByRole("button", { name: "Merge into “My notes”" }).click();

  // "My notes" opens, saying what came in: Linking notes was the same (skipped), Welcome differed.
  await expect(page.getByRole("status").filter({ hasText: "Merged “Work” into “My notes”" })).toContainText(
    "1 under new names because the name was taken, 1 already there",
  );
  await expect(tree(page).getByRole("treeitem", { name: /^Welcome 1/ })).toBeVisible();
  await tree(page).getByRole("treeitem", { name: /^Welcome 1/ }).click();
  await expect(editor(page)).toContainText("Work's own welcome.");
});
