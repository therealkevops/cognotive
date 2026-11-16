import { expect, test } from "@playwright/test";

test("both sidebars collapse to icon rails and come back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const main = page.getByRole("main");
  const wide = (await main.boundingBox())!.width;

  // Collapse both: the editor gets the room.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByRole("button", { name: "Collapse panel" }).click();
  const leftRail = page.getByRole("navigation", { name: "Repository rail" });
  const rightRail = page.getByRole("navigation", { name: "Context rail" });
  await expect(leftRail).toBeVisible();
  await expect(rightRail).toBeVisible();
  await expect(page.getByRole("tree", { name: "Repository files" })).toBeHidden();
  await expect.poll(async () => (await main.boundingBox())!.width).toBeGreaterThan(wide + 400);

  // It's remembered.
  await page.reload();
  await expect(leftRail).toBeVisible();
  await expect(rightRail).toBeVisible();

  // Rail icons open their sidebar on that section.
  await leftRail.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
  await expect(leftRail).toBeHidden();
  await rightRail.getByRole("button", { name: "Outline" }).click();
  await expect(page.getByRole("tab", { name: "Outline" })).toHaveAttribute("aria-selected", "true");

  // Keyboard: Ctrl/Cmd+\ for the left, with Shift for the right.
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(leftRail).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+Backslash");
  await expect(rightRail).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(page.getByRole("tree", { name: "Repository files" }).or(page.getByRole("tab", { name: "Search" }))).toBeVisible();
});
