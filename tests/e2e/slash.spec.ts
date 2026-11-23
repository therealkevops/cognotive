import { expect, test } from "@playwright/test";
import { acceptSuggestion, editor, openApp } from "./helpers";

const menu = (page: import("@playwright/test").Page) => page.locator(".cm-tooltip-autocomplete");

test.beforeEach(async ({ page }) => {
  // Monday 23 November 2026 (and ticking on), so "this tue" is always the same day.
  await page.clock.install({ time: new Date(2026, 10, 23, 9, 0) });
  await openApp(page);
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
});

test("/due with a date in words gives a task a due date, shown before it's written", async ({ page }) => {
  await page.keyboard.type("- [ ] Call Sam /due this tue");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Due Tue 24 Nov");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("this tue · tomorrow");
  await acceptSuggestion(page);
  await expect(editor(page).locator(".cm-line", { hasText: "Call Sam" })).toHaveText("- [ ] Call Sam [due:: 2026-11-24]");

  // In live preview it reads as a date (and turns back into the field when the cursor's on it).
  await page.getByRole("radio", { name: "Live preview" }).click();
  await editor(page).locator(".cm-line").first().click();
  await expect(editor(page).locator(".cm-task-date")).toHaveText("Due Tue 24 Nov");

  // The Tasks panel reads it as due tomorrow.
  await page.getByRole("tab", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Tasks" }).getByRole("group", { name: "Tomorrow" })).toContainText("Call Sam");
});

test("/ lists the commands; choosing one goes straight on to dates", async ({ page }) => {
  await page.keyboard.type("- [ ] Water plants /");
  await expect(menu(page)).toContainText("Blocks");
  await expect(menu(page)).toContainText("Tasks and dates");
  await expect(menu(page)).toContainText("Due date");
  await page.keyboard.type("du");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Due date");
  await acceptSuggestion(page);
  await expect(editor(page).locator(".cm-line", { hasText: "Water plants" })).toHaveText("- [ ] Water plants /due ");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Due Mon 23 Nov");
  await page.keyboard.type("next t");
  await expect(menu(page).getByRole("option")).toHaveCount(2);
  await page.keyboard.press("ArrowDown"); // next thu
  await acceptSuggestion(page);
  await expect(editor(page).locator(".cm-line", { hasText: "Water plants" })).toHaveText("- [ ] Water plants [due:: 2026-12-03]");
});

test("a slash in ordinary writing is left alone, and Escape keeps what was typed", async ({ page }) => {
  await page.keyboard.type("Meet on 24/11 and/or later");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/due someday");
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/due fri");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(editor(page)).toContainText("/due fri");
});

test("/ inserts blocks: a callout, a table edited as a grid, a code block", async ({ page }) => {
  await page.keyboard.type("/callout ti");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Tip");
  await acceptSuggestion(page);
  await page.keyboard.type("Water in the morning.");
  await expect(editor(page)).toContainText("> [!tip]");
  await expect(editor(page)).toContainText("> Water in the morning.");

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table 3x2");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Table, 3 × 2");
  await acceptSuggestion(page);
  await expect(editor(page)).toContainText("| -------- | -------- | -------- |");
});

test("/attach adds a photo and embeds it; /drawing makes one in place", async ({ page }) => {
  await page.keyboard.type("Garden plan ");
  await page.keyboard.type("/attach");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Attach a file or photo");
  const chooser = page.waitForEvent("filechooser");
  await acceptSuggestion(page);
  await (await chooser).setFiles({
    name: "beds.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  });
  await expect(editor(page)).toContainText("Garden plan ![[beds.png]]");

  await page.keyboard.press("Enter");
  await page.keyboard.type("/drawing");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("New drawing");
  await acceptSuggestion(page);
  await expect(editor(page)).toContainText("![[Drawing.excalidraw]]");
  // Saved with the attachments, not opened: the note stays where it was.
  const tree = page.getByRole("tree", { name: "Repository files" });
  await tree.getByRole("treeitem", { name: "attachments" }).click();
  await expect(tree.getByRole("treeitem", { name: /^Drawing/ })).toBeVisible();
  await expect(editor(page)).toContainText("Garden plan");
});

test("/template opens the picker; /daily links a day's note; /priority sets a task's priority", async ({ page }) => {
  await page.keyboard.type("/template");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Insert a template");
  await acceptSuggestion(page);
  await expect(page.getByRole("dialog", { name: "Insert template" })).toBeVisible();
  await page.keyboard.press("Escape");

  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Discuss on /daily this fri");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Daily note Fri 27 Nov");
  await acceptSuggestion(page);
  await expect(editor(page)).toContainText("Discuss on [[Daily/2026-11-27]]");

  await page.keyboard.press("Enter");
  await page.keyboard.type("- [ ] Book flights /priority hi");
  await expect(menu(page).locator("[aria-selected=true]")).toContainText("Highest priority");
  await page.keyboard.press("ArrowDown"); // High, after Highest
  await acceptSuggestion(page);
  await expect(editor(page).locator(".cm-line", { hasText: "Book flights" })).toHaveText("- [ ] Book flights [priority:: high]");
  await page.getByRole("tab", { name: "Tasks" }).click();
  await expect(page.getByRole("region", { name: "Tasks" }).getByRole("listitem").filter({ hasText: "Book flights" })).toContainText("High priority");
});
