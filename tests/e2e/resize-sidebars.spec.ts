import { expect, test, type Page } from "@playwright/test";

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Repository" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Context" });
const width = async (page: Page, side: "left" | "right") => (await (side === "left" ? sidebar(page) : panel(page)).boundingBox())!.width;

test.use({ viewport: { width: 1440, height: 900 } });

test("the sidebar and the side panel can be resized, and keep their widths", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const handle = page.getByRole("separator", { name: "Resize the sidebar" });
  const left = await width(page, "left");
  expect(Math.round(left)).toBe(272);

  // Drag the sidebar's edge to the right.
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + 300);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 90, h.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => width(page, "left")).toBeCloseTo(362, -1);
  await expect(handle).toHaveAttribute("aria-valuenow", /^36\d$/);

  // Not narrower than the smallest width.
  const h2 = (await handle.boundingBox())!;
  await page.mouse.move(h2.x + h2.width / 2, h2.y + 300);
  await page.mouse.down();
  await page.mouse.move(20, h2.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => width(page, "left")).toBe(200);

  // The keyboard: the side panel's edge moves left to make it wider.
  const right = page.getByRole("separator", { name: "Resize the side panel" });
  await right.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => width(page, "right")).toBe(288 + 16 + 48);

  // Kept after a reload.
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await width(page, "left")).toBe(200);
  expect(await width(page, "right")).toBe(352);

  // A double-click puts the default back.
  await handle.dblclick();
  await expect.poll(() => width(page, "left")).toBe(272);
});

test("a collapsed side has no resize handle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Collapse panel" }).click();
  await expect(page.getByRole("separator", { name: "Resize the side panel" })).toHaveCount(0);
  await expect(page.getByRole("separator", { name: "Resize the sidebar" })).toBeVisible();
});
