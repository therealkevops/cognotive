import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";

async function openConnect(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  return dialog;
}

test("connects with a GitHub token, with nothing set up on the deployment, and syncs", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "# Hello from GitHub\n" });
  await github.install(page);

  const dialog = await openConnect(page);
  const form = dialog.getByRole("form", { name: "Connect a GitHub repository" });
  await expect(form).toContainText("GitHub's new token page");
  await form.getByLabel("GitHub token").fill("github_pat_test");
  await form.getByRole("button", { name: "Continue" }).click();
  await expect(form).toContainText("Token for @tester, expires");
  // Public repositories the token can only read aren't offered.
  await expect(form.getByRole("combobox", { name: /^Repository/ }).locator("option", { hasText: "me/website" })).toHaveCount(0);
  await form.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  await form.getByRole("button", { name: "Connect and open" }).click();
  await expect(dialog).toBeHidden();

  const tree = page.getByRole("tree", { name: "Repository files" });
  await expect(tree.getByRole("treeitem", { name: "Hello" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  expect([...github.auth]).toEqual(["Bearer github_pat_test"]);

  // Edits go up with the token.
  await tree.getByRole("treeitem", { name: "Hello" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Synced with a token");
  await page.getByRole("button", { name: /^1 unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
  expect(github.files()["Hello.md"]).toContain("Synced with a token");

  // The token survives a reload: it's kept in this browser.
  await page.reload();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
});

test("a rejected token asks for a new one", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "hi" });
  await github.install(page);
  const dialog = await openConnect(page);
  const form = dialog.getByRole("form", { name: "Connect a GitHub repository" });

  await form.getByLabel("GitHub token").fill("revoked");
  await form.getByRole("button", { name: "Continue" }).click();
  await expect(form).toContainText("didn't accept that token");

  // Connect with a good token, then have GitHub stop accepting it.
  await form.getByLabel("GitHub token").fill("github_pat_good");
  await form.getByRole("button", { name: "Continue" }).click();
  await form.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  await form.getByRole("button", { name: "Connect and open" }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();

  await page.evaluate(async () => {
    // Swap the saved token for one GitHub refuses, as if it expired.
    const req = indexedDB.open("noted-ai:tokens");
    await new Promise((r) => (req.onsuccess = r));
    const db = req.result;
    const store = db.transaction("tokens", "readwrite").objectStore("tokens");
    const keys = await new Promise<IDBValidKey[]>((r) => {
      const k = store.getAllKeys();
      k.onsuccess = () => r(k.result);
    });
    const tx = db.transaction("tokens", "readwrite");
    tx.objectStore("tokens").put({ token: "revoked", login: "tester", expiresAt: null }, keys[0]);
    await new Promise((r) => (tx.oncomplete = r));
  });
  await page.reload();
  await page.getByRole("button", { name: /^Token expired/ }).click();
  const ask = page.getByRole("dialog", { name: "GitHub token" });
  await ask.getByLabel("Token").fill("github_pat_new");
  await ask.getByRole("button", { name: "Save token" }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();
});

test("a token close to expiry shows a reminder", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "hi" });
  const soon = new Date(Date.now() + 3 * 86_400_000 + 3_600_000);
  github.tokenExpiry = `${soon.toISOString().slice(0, 10)} ${soon.toISOString().slice(11, 19)} UTC`;
  await github.install(page);
  const dialog = await openConnect(page);
  const form = dialog.getByRole("form", { name: "Connect a GitHub repository" });
  await form.getByLabel("GitHub token").fill("github_pat_x");
  await form.getByRole("button", { name: "Continue" }).click();
  await form.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  await form.getByRole("button", { name: "Connect and open" }).click();
  await expect(page.getByText(/expires in 3 days/)).toBeVisible();
});
