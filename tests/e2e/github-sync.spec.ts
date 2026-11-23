import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";

async function connectRepo(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByLabel("GitHub token").fill("github_pat_test");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
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
  const tree = page.getByRole("tree", { name: "Repository files" });
  await expect(tree.getByRole("treeitem", { name: "Hello" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Projects" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Welcome" })).toBeHidden();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();

  // Edit locally, then sync now.
  await tree.getByRole("treeitem", { name: "Hello" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Written in Cognotive.ai");
  await expect(page.getByRole("button", { name: /^1 unsynced/ })).toBeVisible();
  await page.getByRole("button", { name: /^1 unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  expect(github.files()["Hello.md"]).toBe("# Hello from GitHub\nWritten in Cognotive.ai");
  expect(github.files()[".obsidian/app.json"]).toBe("{}");

  // A change made elsewhere arrives on the next sync and shows in the open note.
  github.push({ "Hello.md": "# Hello from GitHub\nWritten in Cognotive.ai\nAnd edited on GitHub\n" });
  await page.getByRole("button", { name: /^Synced/ }).click();
  await expect(editor).toContainText("And edited on GitHub");

  // The vault list now has both vaults; switching back shows the local one.
  await page.getByRole("button", { name: /Switch repository/ }).click();
  await page.getByRole("menuitemradio", { name: "My notes" }).click();
  await expect(tree.getByRole("treeitem", { name: "Welcome" })).toBeVisible();
});

test("a device without the token asks for one, and the notes stay readable", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "hi" });
  await github.install(page);
  await connectRepo(page);
  await expect(page.getByRole("tree", { name: "Repository files" }).getByRole("treeitem", { name: "Hello" })).toBeVisible();

  // Forget the saved token, as on a device that never had it.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("noted-ai:tokens");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: /^Add token/ })).toBeVisible();
  // The cloned notes are still readable from the browser copy.
  await expect(page.getByRole("tree", { name: "Repository files" }).getByRole("treeitem", { name: "Hello" })).toBeVisible();
});

test("a conflict stays in the note, and is resolved side by side", async ({ page }) => {
  const github = new FakeGitHub({ "Plan.md": "# Plan\n\nstart\n\nmiddle\n\nend" });
  await github.install(page);
  await connectRepo(page);
  const tree = page.getByRole("tree", { name: "Repository files" });
  await tree.getByRole("treeitem", { name: "Plan" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  const editor = page.locator(".cm-content");

  // The same line changes here and on GitHub; GitHub also changes the heading.
  await editor.getByText("start").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (mine)");
  github.push({ "Plan.md": "# Plan!\n\nstart (theirs)\n\nmiddle\n\nend" });
  await page.getByRole("button", { name: /^1 unsynced/ }).click();

  // No copy file: the note keeps GitHub's line there for now, with everything else merged.
  const banner = page.getByRole("region", { name: "Conflict" });
  await expect(banner).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /conflict/ })).toHaveCount(0);
  await expect(editor).toContainText("# Plan!");
  await expect(editor).toContainText("start (theirs)");

  await banner.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Conflict in Plan" });
  const first = dialog.getByRole("listitem", { name: "Conflict 1" });
  await expect(first).toContainText("start (theirs)");
  await expect(first).toContainText("start (mine)");
  await first.getByRole("radio", { name: "Keep yours" }).click();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  await expect(banner).toBeHidden();
  await expect(editor).toContainText("# Plan!");
  await expect(editor).toContainText("start (mine)");
  await expect(editor).not.toContainText("theirs");

  // The resolved note goes up on the next sync.
  await page.getByRole("button", { name: /^1 unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  expect(github.files()["Plan.md"]).toBe("# Plan!\n\nstart (mine)\n\nmiddle\n\nend");
});

test("attachment properties sync in .noted/properties.json", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "hi" });
  await github.install(page);
  await connectRepo(page);
  await page.getByLabel("Choose files to add").setInputFiles({
    name: "pic.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  });
  const props = page.getByTestId("file-view").getByRole("region", { name: "Properties" });
  await props.getByRole("button", { name: "Add property" }).click();
  await props.getByRole("combobox", { name: "New property name" }).fill("hub");
  await page.keyboard.press("Enter");
  await expect(props.getByRole("checkbox", { name: "hub" })).toBeChecked();
  await page.getByRole("button", { name: /unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  const stored = JSON.parse(String(github.files()[".noted/properties.json"]));
  expect(Object.values(stored)).toEqual([{ hub: true }]);
  expect(Object.keys(stored)[0]).toMatch(/pic\.png$/);
});
