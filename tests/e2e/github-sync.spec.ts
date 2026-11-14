import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";

async function connectRepo(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByText("Signed in as @tester")).toBeVisible();
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByRole("combobox").first().selectOption("me/notes");
  await dialog.getByRole("button", { name: "Connect and open" }).click();
  // Opening the new vault replaces the workspace, which closes the dialog.
  await expect(dialog).toBeHidden();
}

test("connects a repository, clones it, and syncs edits both ways", async ({ page }) => {
  const github = new FakeGitHub({
    "Hello.md": "# Hello from GitHub\n",
    "Projects/Plan.md": "Plan\n",
    ".obsidian/app.json": "{}",
  });
  await github.install(page);
  await connectRepo(page);

  // Cloned: the repo's notes appear; hidden files don't.
  const tree = page.getByRole("tree", { name: "Vault files" });
  await expect(tree.getByRole("treeitem", { name: "Hello" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Projects" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Welcome" })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();

  // Edit locally, then sync now.
  await tree.getByRole("treeitem", { name: "Hello" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Written in noted-ai");
  await expect(page.getByRole("button", { name: /^1 unsynced/ })).toBeVisible();
  await page.getByRole("button", { name: /^1 unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  expect(github.files()["Hello.md"]).toBe("# Hello from GitHub\nWritten in noted-ai");
  expect(github.files()[".obsidian/app.json"]).toBe("{}");

  // A change made elsewhere arrives on the next sync and shows in the open note.
  github.push({ "Hello.md": "# Hello from GitHub\nWritten in noted-ai\nAnd edited on GitHub\n" });
  await page.getByRole("button", { name: /^Synced/ }).click();
  await expect(editor).toContainText("And edited on GitHub");

  // The vault list now has both vaults; switching back shows the local one.
  await page.getByRole("button", { name: /Switch vault/ }).click();
  await page.getByRole("menuitemradio", { name: "My notes" }).click();
  await expect(tree.getByRole("treeitem", { name: "Welcome" })).toBeVisible();
});

test("a GitHub vault asks to sign in when the session has ended", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "hi" });
  await github.install(page);
  await connectRepo(page);
  await expect(page.getByRole("tree", { name: "Vault files" }).getByRole("treeitem", { name: "Hello" })).toBeVisible();

  await page.unroute("**/api/auth/token");
  await page.route("**/api/auth/token", (route) => route.fulfill({ status: 401, json: { error: "signed_out" } }));
  await page.reload();
  await expect(page.getByRole("button", { name: /^Sign in to sync/ })).toBeVisible();
  // The cloned notes are still readable offline from the browser copy.
  await expect(page.getByRole("tree", { name: "Vault files" }).getByRole("treeitem", { name: "Hello" })).toBeVisible();
});
