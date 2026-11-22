import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("on a phone, the settings tabs never run under the close button", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Open sidebar" }).or(page.getByRole("button", { name: /sidebar/i })).first().click();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const close = dialog.getByRole("button", { name: "Close settings" });
  const tabs = dialog.getByRole("navigation", { name: "Settings sections" });
  await expect(close).toBeVisible();

  // Wherever the tabs are scrolled to, nothing sits under the close button, and the chosen tab is in view.
  const clear = async () => {
    const x = (await close.boundingBox())!;
    for (const tab of await tabs.getByRole("button").all()) {
      const b = await tab.boundingBox();
      if (!b) continue;
      const overlaps = b.x < x.x + x.width && x.x < b.x + b.width && b.y < x.y + x.height && x.y < b.y + b.height;
      expect(overlaps, `"${await tab.textContent()}" is under the close button`).toBe(false);
    }
  };
  await clear();
  for (const name of ["Editor", "Repositories & sync", "Install app", "Search"]) {
    await tabs.getByRole("button", { name }).click();
    await expect(tabs.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
    await clear();
  }

  await close.click();
  await expect(dialog).toBeHidden();
});
