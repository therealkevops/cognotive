import { expect, test, type Page } from "@playwright/test";

const banner = (page: Page) => page.getByRole("region", { name: "Back up your notes" });
const DAY = 86_400_000;

/** A repository first opened here a month ago, never backed up. */
async function monthOld(page: Page) {
  await page.addInitScript((t) => {
    if (!localStorage.getItem("noted-ai:vault:default:firstSeen")) localStorage.setItem("noted-ai:vault:default:firstSeen", String(t));
  }, Date.now() - 30 * DAY);
}

async function edit(page: Page) {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nA new thought.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test("a local repository that changed since a long time ago is reminded to back up; exporting clears it", async ({ page }) => {
  await monthOld(page);
  await edit(page);
  await page.reload();
  await expect(banner(page)).toContainText("only in this browser");
  const download = page.waitForEvent("download");
  await banner(page).getByRole("button", { name: "Export backup" }).click();
  expect((await download).suggestedFilename()).toMatch(/^My notes \d{4}-\d{2}-\d{2}\.zip$/);
  await expect(banner(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("the reminder can wait a week, and Connect GitHub opens the repository settings", async ({ page }) => {
  await monthOld(page);
  await edit(page);
  await page.reload();
  await banner(page).getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toContainText("Repositories & sync");
  await page.getByRole("button", { name: "Close settings" }).click();
  await banner(page).getByRole("button", { name: "Later" }).click();
  await expect(banner(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("a new repository isn't nagged", async ({ page }) => {
  await edit(page);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test("Settings says whether the browser keeps the notes, and how much space they use", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Storage" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog.getByText(/^(Kept permanently|May be cleared by the browser)$/)).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Storage" })).toContainText(/[\d.]+ (KB|MB|GB) used of [\d.]+ (KB|MB|GB) the browser allows this site/);
});

test("Storage breaks the space down, and the search model can be removed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  // A stand-in for the downloaded search model, cached the way transformers.js does it.
  await page.evaluate(async () => {
    const cache = await caches.open("transformers-cache");
    await cache.put("/models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx", new Response(new Uint8Array(3 * 1024 * 1024)));
  });

  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("Show storage");
  await page.keyboard.press("Enter");
  const kinds = page.getByRole("list", { name: "Storage by kind" });
  const row = (label: string) => kinds.getByRole("listitem").filter({ hasText: label });
  await expect(row("Notes and drawings")).toContainText(/\d+ files/);
  await expect(row("Attachments")).toContainText("0 files");
  await expect(row("Search model")).toContainText("Downloaded from this app for search by meaning");
  await expect(row("Search model")).toContainText("3.0 MB");
  await expect(page.getByRole("img", { name: /Notes and drawings [\d.]+ KB, Search model 3.0 MB/ })).toBeVisible();

  await row("Search model").getByRole("button", { name: "Remove" }).click();
  await expect(row("Search model")).toContainText("Not downloaded");
  await expect(row("Search model")).toContainText("0 KB");
  expect(await page.evaluate(() => caches.has("transformers-cache"))).toBe(false);
});
