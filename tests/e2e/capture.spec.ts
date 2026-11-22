import { expect, test, type Page } from "@playwright/test";
import { editor, ymd } from "./helpers";

const today = ymd(new Date());
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function openCaptured(page: Page, name: string) {
  const toast = page.getByRole("status").filter({ hasText: `Captured to ${name}.` });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(name);
  await page.getByRole("radio", { name: "Source" }).click();
}

test("quick capture adds timed items to today's note, with attachments", async ({ page }) => {
  // The icon shortcut opens the capture box.
  await page.goto("/?action=capture");
  const dialog = page.getByRole("dialog", { name: "Quick capture" });
  await expect(dialog).toContainText(`Adds to today's note (${today}), with the time.`);
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await dialog.getByLabel("Note").fill("Call Ann about the venue\nand the date");
  await dialog.getByLabel("Choose files to attach").setInputFiles({ name: "whiteboard.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.getByRole("list", { name: "Attachments" })).toContainText("whiteboard.png");
  await dialog.getByLabel("Note").press("ControlOrMeta+Enter");
  await expect(dialog).toBeHidden();
  await openCaptured(page, today);
  await expect(editor(page)).toContainText("## Captured");
  await expect(editor(page)).toContainText(/- \d{2}:\d{2} Call Ann about the venue/);
  await expect(editor(page)).toContainText("and the date");
  await expect(editor(page)).toContainText("![[whiteboard.png]]");

  // A second capture, from the sidebar, joins the same list.
  await page.getByRole("button", { name: "Quick capture" }).click();
  await page.getByRole("dialog", { name: "Quick capture" }).getByLabel("Note").fill("Buy stamps");
  await page.getByRole("dialog", { name: "Quick capture" }).getByRole("button", { name: "Save" }).click();
  await expect(editor(page)).toContainText(/!\[\[whiteboard\.png\]\]- \d{2}:\d{2} Buy stamps/);
});

test("captures can go to an inbox note instead", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "This repository" }).click();
  await page.getByLabel("Captures go to").selectOption("inbox");
  await expect(page.getByLabel("Inbox note")).toHaveValue("Inbox.md");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("Quick capture");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Quick capture" });
  await expect(dialog).toContainText("Adds to Inbox");
  await dialog.getByLabel("Note").fill("An idea for later");
  await dialog.getByRole("button", { name: "Save" }).click();
  await openCaptured(page, "Inbox");
  await expect(editor(page)).toContainText("# Inbox");
  await expect(editor(page)).toContainText(/## Captured- \d{2}:\d{2} An idea for later/);
});

test.describe("with the service worker", () => {
  test.use({ serviceWorkers: "allow" });
  test("sharing to the installed app goes through the service worker into quick capture", async ({ page }) => {
    await page.goto("/");
    await expect(editor(page)).toBeVisible();
    // Wait for the service worker to control the page (it does from the next load).
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // What Android's share sheet sends: a form POST to the share target.
    const status = await page.evaluate(async (png) => {
      const form = new FormData();
      form.append("title", "A great post");
      form.append("text", "Worth reading https://example.com/post");
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      form.append("files", new File([bytes], "screenshot.png", { type: "image/png" }));
      const res = await fetch("/share-target", { method: "POST", body: form });
      return { redirected: res.redirected, url: res.url };
    }, PNG.toString("base64"));
    expect(status.redirected).toBe(true);
    expect(new URL(status.url).search).toBe("?action=shared");

    await page.goto("/?action=shared");
    const dialog = page.getByRole("dialog", { name: "Save what you shared" });
    await expect(dialog).toContainText("A great post");
    await expect(dialog).toContainText("https://example.com/post");
    await expect(dialog.getByLabel("Note")).toHaveValue("Worth reading");
    await expect(dialog.getByRole("list", { name: "Attachments" })).toContainText("screenshot.png");
    await dialog.getByLabel("Note").fill("Worth reading, especially part 2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await openCaptured(page, today);
    await expect(editor(page)).toContainText(/- \d{2}:\d{2} \[A great post\]\(https:\/\/example\.com\/post\) Worth reading, especially part 2/);
    await expect(editor(page)).toContainText("![[screenshot.png]]");

    // It was taken: opening the share again shows nothing.
    await page.goto("/?action=shared");
    await expect(editor(page)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Save what you shared" })).toHaveCount(0);
  });
});
