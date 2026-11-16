import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";

async function startConnecting(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  return dialog;
}

test("an encrypted repository stores only ciphertext, and another device unlocks it", async ({ browser, page }) => {
  const github = new FakeGitHub({}); // a new, empty repository
  await github.install(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  // Turn encryption on while connecting.
  let dialog = await startConnecting(page);
  const encryption = dialog.getByRole("group", { name: "Encryption" });
  await expect(encryption.getByLabel(/Encrypt this repository/)).toBeChecked();
  await encryption.getByRole("textbox", { name: /^Passphrase/ }).fill("correct horse battery");
  await encryption.getByLabel("Confirm passphrase").fill("correct horse battery");
  await dialog.getByRole("button", { name: "Connect and open" }).click();

  // The recovery key is shown once; opening waits until it's been saved.
  const step = dialog.getByRole("region", { name: "Recovery key" });
  const recoveryKey = (await step.getByLabel("Recovery key value").innerText()).trim();
  expect(recoveryKey).toMatch(/^([a-z2-7]{4}-){12}[a-z2-7]{4}$/);
  await expect(step.getByRole("button", { name: "Open repository" })).toBeDisabled();
  await step.getByLabel(/I've saved my recovery key/).check();
  await step.getByRole("button", { name: "Open repository" }).click();
  await expect(dialog).toBeHidden();

  // Write a note and sync it.
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Note title" });
  await title.fill("Therapy notes");
  await title.press("Enter");
  await page.locator(".cm-content").click();
  await page.keyboard.type("Talked about the move to Lisbon.");
  await page.getByRole("button", { name: /unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();

  // GitHub holds the settings, a README, and scrambled files only.
  const files = github.files();
  const paths = Object.keys(files).sort();
  expect(paths).toContain(".noted/encryption.json");
  expect(paths).toContain("README.md");
  const stored = paths.filter((p) => p !== ".noted/encryption.json" && p !== "README.md");
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.every((p) => /^encrypted\/[a-z2-7]+$/.test(p))).toBe(true);
  const everything = JSON.stringify(files);
  expect(everything).not.toMatch(/therapy|lisbon|move/i);
  expect(everything).not.toContain(recoveryKey.replaceAll("-", ""));

  // A second device: the wrong passphrase is refused, the recovery key works.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await github.install(page2);
  dialog = await startConnecting(page2);
  const enc2 = dialog.getByRole("group", { name: "Encryption" });
  await expect(enc2).toContainText("This repository is encrypted");
  await enc2.getByLabel("Passphrase").fill("wrong passphrase");
  await dialog.getByRole("button", { name: "Connect and open" }).click();
  await expect(dialog).toContainText("That passphrase isn't right.");
  await enc2.getByRole("button", { name: "Use the recovery key instead" }).click();
  await enc2.getByLabel("Recovery key").fill(recoveryKey.toUpperCase());
  await dialog.getByRole("button", { name: "Connect and open" }).click();
  await expect(dialog).toBeHidden();
  const tree = page2.getByRole("tree", { name: "Repository files" });
  await tree.getByRole("treeitem", { name: "Therapy notes" }).click();
  await expect(page2.locator(".cm-content")).toContainText("Talked about the move to Lisbon.");

  // Forgetting the key locks sync until the passphrase is entered again.
  await page2.getByRole("button", { name: "Settings" }).click();
  const settings = page2.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Repositories & sync" }).click();
  await settings.getByRole("listitem").filter({ hasText: "encrypted" }).getByRole("button", { name: "Edit" }).click();
  page2.once("dialog", (d) => void d.accept());
  await settings.getByRole("button", { name: "Forget key" }).click();
  await page2.getByRole("button", { name: /^Locked/ }).click();
  const unlock = page2.getByRole("dialog", { name: "Unlock repository" });
  await unlock.getByLabel("Passphrase").fill("correct horse battery");
  await unlock.getByRole("button", { name: "Unlock" }).click();
  await expect(page2.getByRole("button", { name: /^Synced/ })).toBeVisible();
  await other.close();
});

test("a repository that already has notes can't be encrypted", async ({ page }) => {
  const github = new FakeGitHub({ "Hello.md": "hi" });
  await github.install(page);
  const dialog = await startConnecting(page);
  await expect(dialog.getByRole("group", { name: "Encryption" })).toContainText("already has unencrypted files");
});
