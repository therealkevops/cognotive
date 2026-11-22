import { expect, type Page } from "@playwright/test";

/* Helpers shared by the end-to-end tests. */

/** The note editor's content. */
export const editor = (page: Page) => page.locator(".cm-content");
/** The open note's title box. */
export const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
/** The file tree in the sidebar. */
export const tree = (page: Page) => page.getByRole("tree", { name: "Repository files" });

/** Loads the app and waits for the editor. */
export async function openApp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
}

/** Runs a command from the command palette. */
export async function palette(page: Page, command: string) {
  await page.keyboard.press("ControlOrMeta+p");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.getByRole("combobox").fill(command);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** A date as YYYY-MM-DD, in local time. */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** An OpenRouter key the fake provider accepts. */
export const GOOD_KEY = "sk-or-v1-good-key-0123456789abcdefghij";

/**
 * Accepts the highlighted suggestion. CodeMirror ignores Enter for a short moment (75 ms)
 * after the suggestion list opens or changes, so a keypress straight away would be lost.
 */
export async function acceptSuggestion(page: Page) {
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
}
