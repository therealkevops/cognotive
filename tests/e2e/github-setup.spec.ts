import { expect, test } from "@playwright/test";

test("Set up GitHub creates the app from a manifest and lists the Vercel variables", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let manifest: Record<string, unknown> | null = null;
  // Never reach the real GitHub: anything not faked below fails.
  await page.route(/^https:\/\/(api\.)?github\.com\//, (route) => route.abort());
  // Fake GitHub: the "create app" page sends the user straight back with a code.
  await page.route("https://github.com/settings/apps/new**", async (route) => {
    const req = route.request();
    manifest = JSON.parse(new URLSearchParams(req.postData() ?? "").get("manifest") ?? "null");
    const state = new URL(req.url()).searchParams.get("state");
    const origin = new URL(page.url()).origin;
    await route.fulfill({ status: 302, headers: { location: `${origin}/github-setup?code=onetime123&state=${state}` } });
  });
  await page.route("https://api.github.com/app-manifests/onetime123/conversions", (route) =>
    route.fulfill({
      json: {
        slug: "noted-ai-test",
        name: "noted-ai-test",
        html_url: "https://github.com/apps/noted-ai-test",
        client_id: "Iv1.client",
        client_secret: "very-secret",
        owner: { id: 4242, login: "tester" },
      },
    }),
  );

  // The test server has no GitHub settings, so Settings offers the setup.
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "GitHub account" }).click();
  await page.getByRole("link", { name: "Set up GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Set up GitHub sync" })).toBeVisible();

  await page.getByLabel("App name").fill("noted-ai-test");
  await page.getByRole("button", { name: "Create GitHub App" }).click();

  const vars = page.getByRole("table", { name: "Environment variables" });
  await expect(vars).toBeVisible();
  expect(manifest).toMatchObject({
    name: "noted-ai-test",
    default_permissions: { contents: "write" },
    callback_urls: [expect.stringMatching(/\/api\/auth\/callback$/)],
  });
  await expect(vars.getByRole("row", { name: /GITHUB_APP_CLIENT_ID/ })).toContainText("Iv1.client");
  await expect(vars.getByRole("row", { name: /ALLOWED_GITHUB_USER_IDS/ })).toContainText("4242");
  // Secrets are hidden but can be copied.
  await expect(vars).not.toContainText("very-secret");
  await page.getByRole("button", { name: "Copy all", exact: true }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("GITHUB_APP_CLIENT_SECRET=very-secret");
  expect(copied).toMatch(/SESSION_SECRET=\S{40,}/);
  // The one-time code doesn't stay in the address bar.
  expect(page.url()).not.toContain("onetime123");
  await expect(page.getByRole("link", { name: "Install the app" })).toHaveAttribute(
    "href",
    "https://github.com/apps/noted-ai-test/installations/new",
  );
});

test("a setup link that didn't start here is ignored", async ({ page }) => {
  await page.goto("/github-setup?code=abc&state=forged");
  await expect(page.getByRole("alert").filter({ hasText: "setup link" })).toContainText("didn't start here");
});
