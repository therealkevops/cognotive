import { strToU8, unzipSync, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });

async function openApp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
}

async function palette(page: Page, command: string) {
  await page.keyboard.press("ControlOrMeta+p");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox").fill(command);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

test("the command palette runs commands", async ({ page }) => {
  await openApp(page);
  await palette(page, "new drawing");
  await expect(title(page)).toHaveValue("Drawing");
});

test("Today opens (and reuses) the daily note", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Today" }).click();
  const today = new Date().toISOString().slice(0, 10); // default format YYYY-MM-DD
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  await expect(title(page)).toHaveValue(new RegExp(`^(${today}|${local})$`));
  await expect(tree(page).getByRole("treeitem", { name: "Daily" })).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(tree(page).getByRole("treeitem", { name: /^\d{4}-\d{2}-\d{2}$/ })).toHaveCount(0); // folder collapsed: one note
});

test("zip import brings in templates, which fill in when inserted", async ({ page }) => {
  await openApp(page);
  const zip = zipSync({ "Vault/Templates/Meeting.md": strToU8("# {{title}}\nDate: {{date:YYYY}}\n\n- [ ] ") });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "vault.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 1 file" })).toBeVisible();
  await expect(tree(page).getByRole("treeitem", { name: "Templates" })).toBeVisible();

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
  await palette(page, "insert template");
  const picker = page.getByRole("dialog", { name: "Insert template" });
  await picker.getByRole("option", { name: /Meeting/ }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText(`# UntitledDate: ${new Date().getFullYear()}`);
});

test("export downloads the vault as a zip", async ({ page }) => {
  await openApp(page);
  const download = page.waitForEvent("download");
  await palette(page, "export vault");
  const file = await (await download).path();
  const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(file))));
  expect(entries).toEqual(expect.arrayContaining(["Welcome.md", "Linking notes.md"]));
});

test("tabs keep opened notes, and the side pane shows another note", async ({ page }) => {
  await openApp(page);
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  const tabs = page.getByRole("tablist", { name: "Open notes" });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await tabs.getByRole("tab", { name: /Welcome/ }).click();
  await expect(title(page)).toHaveValue("Welcome");
  // The close button of an inactive tab appears on hover.
  await tabs.getByRole("tab", { name: /Linking notes/ }).hover();
  await page.getByRole("button", { name: "Close Linking notes" }).click();
  await expect(tabs).toBeHidden(); // a single tab isn't shown

  const item = tree(page).getByRole("treeitem", { name: "Linking notes" });
  await item.hover();
  await page.getByRole("button", { name: "Open Linking notes in the side pane" }).click();
  const side = page.getByRole("region", { name: "Side pane" });
  await expect(side.getByRole("heading", { name: "Linking notes", level: 1 })).toBeVisible();
  await expect(title(page)).toHaveValue("Welcome");
});

test("appearance settings apply and persist", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const appearance = page.getByRole("region", { name: "Appearance" });
  await appearance.getByLabel("Theme").selectOption("dark");
  await appearance.getByRole("button", { name: "teal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(15, 17, 21)");
});

test("live preview renders tables and highlights tags", async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await expect(editor(page).locator(".cm-rendered-table table")).toBeVisible();
  // Switching to another note starts it at the top (not at Welcome's scroll position).
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await expect(editor(page).locator(".cm-tag").first()).toHaveText("#guide");
  expect(await page.locator(".cm-scroller").evaluate((s) => s.scrollTop)).toBeLessThan(100);
});

test("version history shows past versions and restores one", async ({ page }) => {
  const github = new FakeGitHub({ "Plan.md": "first draft\n" });
  github.push({ "Plan.md": "second draft\n" }, "edit on GitHub");
  await github.install(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  await dialog.getByRole("button", { name: "Connect and open" }).click();
  await tree(page).getByRole("treeitem", { name: "Plan" }).click();
  await expect(editor(page)).toHaveText("second draft");

  await page.getByRole("button", { name: "Version history" }).click();
  const history = page.getByRole("dialog", { name: "Version history" });
  const versions = history.getByRole("list", { name: "Versions" }).getByRole("button");
  await expect(versions).toHaveCount(2);
  await versions.nth(1).click();
  await expect(history.getByTestId("history-diff")).toContainText("first draft");
  await history.getByRole("button", { name: "Restore this version" }).click();
  await expect(history).toBeHidden();
  await expect(editor(page)).toHaveText("first draft");
});

test.describe("installable app", () => {
  test.use({ serviceWorkers: "allow" });

  test("has a manifest and registers a service worker", async ({ page, request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ name: "noted-ai", display: "standalone" });
    await openApp(page);
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? ""))
      .toContain("/sw.js");
  });
});
