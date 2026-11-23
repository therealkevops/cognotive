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
  await expect(menu(page)).toContainText("Due date");
  await expect(menu(page)).toContainText("Scheduled date");
  await acceptSuggestion(page); // Due date
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
