import { expect, test } from "@playwright/test";
import { editor, title } from "./helpers";

test("edits are still there after switching to reading view and back", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
  await page.keyboard.type("Fresh words in a new note.");

  await page.getByRole("radio", { name: "Reading" }).click();
  await expect(page.getByTestId("reading-view")).toContainText("Fresh words in a new note.");
  await page.getByRole("radio", { name: "Live preview" }).click();
  await expect(editor(page)).toHaveText("Fresh words in a new note.");

  // And the same through source mode, with more typing in between.
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" More.");
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.getByTestId("reading-view")).toContainText("More.");
  await page.keyboard.press("ControlOrMeta+e");
  await expect(editor(page)).toHaveText("Fresh words in a new note. More.");
});

test("the browser checks spelling, and a setting turns it off", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toHaveAttribute("spellcheck", "true");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Editor" }).click();
  const toggle = page.getByRole("switch", { name: "Check spelling" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveAttribute("spellcheck", "false");
  await page.reload();
  await expect(editor(page)).toHaveAttribute("spellcheck", "false");
});
