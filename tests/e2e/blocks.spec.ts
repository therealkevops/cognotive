import { expect, test, type Page } from "@playwright/test";
import { acceptSuggestion, editor, title, tree } from "./helpers";

const selected = (page: Page) => page.locator(".cm-tooltip-autocomplete [aria-selected=true]");

async function newNote(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).click();
}

async function pick(page: Page, text: string) {
  await expect(selected(page)).toContainText(text);
  await acceptSuggestion(page);
}

test("[[Note#^ suggests blocks and gives the chosen one an id", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("See [[Welcome#^repository lives");
  await pick(page, "This repository lives in your browser");
  const text = (await editor(page).innerText()).trim();
  const id = /\[\[Welcome#\^([a-z0-9]{6})\]\]/.exec(text)?.[1];
  expect(id).toBeTruthy();

  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await expect(editor(page)).toContainText(`[[Linking notes]]. ^${id}`);
});

test("[[#^ links to a block in this note, and [[# to a heading", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("# Plans\n\nAlpha idea\n\nBeta idea\n\nSee [[#^Beta");
  await pick(page, "Beta idea");
  await expect(editor(page)).toContainText(/Beta idea \^[a-z0-9]{6}/);
  await expect(editor(page)).toContainText(/See \[\[#\^[a-z0-9]{6}\]\]/);
  const text = await editor(page).innerText();
  expect(/Beta idea \^(\w+)/.exec(text)?.[1]).toBe(/\[\[#\^(\w+)\]\]/.exec(text)?.[1]);

  await page.keyboard.press("End");
  await page.keyboard.type(" and [[#Pl");
  await pick(page, "Plans");
  await expect(editor(page)).toContainText("and [[#Plans]]");
});

test("an existing block id is reused", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("Kept ^keep1\n\nLink [[#^Kept");
  await pick(page, "Kept");
  await expect(editor(page)).toContainText("Link [[#^keep1]]");
  await expect(editor(page)).toContainText("Kept ^keep1");
});
