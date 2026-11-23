import { expect, test, type Page } from "@playwright/test";
import { editor, title, tree } from "./helpers";

/** An image made in the page (noise, so it doesn't compress away), as bytes. */
async function makeImage(page: Page, width: number, height: number, type: "image/jpeg" | "image/png"): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height, type }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(width, height);
      let seed = 7;
      for (let i = 0; i < img.data.length; i += 4) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        img.data[i] = (i / 4) % width & 255;
        img.data[i + 1] = seed & 255;
        img.data[i + 2] = (seed >> 8) & 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const blob = await canvas.convertToBlob({ type, quality: 0.95 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { width, height, type },
  );
  return Buffer.from(base64, "base64");
}

const add = (page: Page, name: string, mimeType: string, buffer: Buffer) =>
  page.getByLabel("Choose files to add").setInputFiles({ name, mimeType, buffer });

test("an added photo is kept smaller: at most 2000 pixels, as WebP", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  const photo = await makeImage(page, 3000, 2000, "image/jpeg");
  expect(photo.length).toBeGreaterThan(1_000_000);
  await add(page, "Holiday.jpg", "image/jpeg", photo);
  await expect(title(page)).toHaveValue("Holiday");
  await expect(tree(page).getByRole("treeitem", { name: "Holiday.webp" })).toBeVisible();
  const img = page.getByTestId("file-view").locator("img");
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(2000);
  const kept = await img.evaluate(async (i: HTMLImageElement) => (await (await fetch(i.src)).blob()).size);
  expect(kept).toBeLessThan(photo.length / 2);
});

test("a small image is kept as it is", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  const icon = await makeImage(page, 64, 64, "image/png");
  await add(page, "icon.png", "image/png", icon);
  await expect(tree(page).getByRole("treeitem", { name: "icon.png" })).toBeVisible();
});

test("Settings lists attachments nothing uses, and deletes them", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await add(page, "used.png", "image/png", await makeImage(page, 40, 40, "image/png"));
  await add(page, "spare.png", "image/png", await makeImage(page, 50, 50, "image/png"));
  await expect(tree(page).getByRole("treeitem", { name: "spare.png" })).toBeVisible();

  // Embed one of them in a note.
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\n![[used.png]]");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Storage" }).click();
  const unused = dialog.getByRole("region", { name: "Unused attachments" });
  await expect(unused).toContainText("spare.png");
  await expect(unused).not.toContainText("used.png");
  page.once("dialog", (d) => void d.accept());
  await unused.getByRole("button", { name: "Delete spare.png" }).click();
  await expect(unused).toContainText("Every attachment in this repository is used");
  await page.keyboard.press("Escape");
  await expect(tree(page).getByRole("treeitem", { name: "spare.png" })).toHaveCount(0);
  await expect(tree(page).getByRole("treeitem", { name: "used.png" })).toBeVisible();
});

test("a warning when storage is nearly full, which can be put off or followed", async ({ page }) => {
  // As if the browser said this site has used 90% of what it allows.
  await page.addInitScript(() => {
    const storage = navigator.storage;
    if (storage) storage.estimate = async () => ({ usage: 900 * 1024 * 1024, quota: 1000 * 1024 * 1024 });
  });
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  const banner = page.getByRole("region", { name: "Storage nearly full" });
  await expect(banner).toContainText("90% full");
  await banner.getByRole("button", { name: "Free up space" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("region", { name: "Unused attachments" })).toBeVisible();
  await page.keyboard.press("Escape");
  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Storage nearly full" })).toBeHidden();
});

test("a storage limit: warnings measure against it, and new attachments stop at it", async ({ page }) => {
  // The browser reports 100 MB used of 2 GB.
  await page.addInitScript(() => {
    const storage = navigator.storage;
    if (storage) storage.estimate = async () => ({ usage: 100 * 1024 * 1024, quota: 2000 * 1024 * 1024 });
  });
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Storage nearly full" })).toBeHidden();

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Storage" }).click();
  const limit = dialog.getByLabel("Limit for this app");
  await expect(limit).toHaveValue("none");
  await limit.selectOption({ label: "250 MB" });
  await expect(dialog).toContainText("of your 250 MB limit");
  // A custom limit, just above what's used: the warning appears.
  await limit.selectOption("custom");
  await dialog.getByLabel("Custom limit").fill("110");
  await dialog.getByLabel("Unit").selectOption("MB");
  await page.keyboard.press("Escape");
  const banner = page.getByRole("region", { name: "Storage nearly full" });
  await expect(banner).toContainText("of the 110 MB limit you set");

  // A 20 MB file would go over it: refused, and nothing is added.
  await add(page, "Big report.pdf", "application/pdf", Buffer.alloc(20 * 1024 * 1024, 1));
  await expect(page.getByRole("alert").filter({ hasText: "Not added: Big report.pdf" })).toContainText("110 MB storage limit");
  await expect(tree(page).getByRole("treeitem", { name: "Big report.pdf" })).toHaveCount(0);

  // Back to the browser's limit (kept after a reload): it's added.
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await dialog.getByRole("button", { name: "Storage" }).click();
  await expect(dialog.getByLabel("Limit for this app")).toHaveValue("custom");
  await expect(dialog.getByLabel("Custom limit")).toHaveValue("110");
  await dialog.getByLabel("Limit for this app").selectOption("none");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Storage nearly full" })).toBeHidden();
  await add(page, "Big report.pdf", "application/pdf", Buffer.alloc(20 * 1024 * 1024, 1));
  await expect(tree(page).getByRole("treeitem", { name: "Big report.pdf" })).toBeVisible();
});
