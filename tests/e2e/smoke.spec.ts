import { expect, test } from "@playwright/test";

test("home page shows the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("noted-ai");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("noted-ai");
  await expect(page.getByRole("main")).toBeVisible();
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", app: "noted-ai" });
});
