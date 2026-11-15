import { expect, test } from "@playwright/test";

const title = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "Note title" });

test("the manifest offers app shortcuts and the icons are served", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ id: "/", display: "standalone", theme_color: "#faf9f5" });
  expect(manifest.shortcuts.map((s: { name: string }) => s.name)).toEqual([
    "New note",
    "Today's note",
    "Search notes",
    "New canvas",
  ]);
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
  }
});

test("app shortcuts open the app and run their action", async ({ page }) => {
  await page.goto("/?action=new-note");
  await expect(title(page)).toHaveValue("Untitled");
  await expect(page).toHaveURL(/\/$/); // the action is removed from the address

  await page.goto("/?action=search");
  await expect(page.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
});

test("Settings offers to install when the browser allows it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  // Pretend to be a browser offering an install (Chromium fires this event).
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt") as Event & { prompt(): Promise<void>; userChoice: Promise<unknown> };
    e.prompt = async () => {
      (window as unknown as { prompted: boolean }).prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("install");
  await page.keyboard.press("Enter");
  const section = page.getByRole("region", { name: "Install app" });
  await section.getByRole("button", { name: "Install" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
});
