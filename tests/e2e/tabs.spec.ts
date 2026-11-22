import { expect, test, type Page } from "@playwright/test";
import { editor, openApp, tree } from "./helpers";

/* Two tabs on the same repository share the browser's storage and keep in step. */

async function source(page: Page) {
  await page.getByRole("radio", { name: "Source" }).click();
}

/** Types at the end of the line holding `text`. */
async function typeAfter(page: Page, text: string, typed: string) {
  await editor(page).getByText(text, { exact: false }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(typed);
}

test("a change saved in one tab shows in the other", async ({ context }) => {
  const a = await context.newPage();
  await openApp(a);
  const b = await context.newPage();
  await openApp(b);
  await source(a);
  await source(b);

  // The open note, edited in A, updates in B.
  await typeAfter(a, "# Welcome to noted-ai", " (edited in A)");
  await expect(a.getByText("Saved", { exact: true })).toBeVisible();
  await expect(editor(b)).toContainText("# Welcome to noted-ai (edited in A)");

  // A new note made in A appears in B's file tree.
  await a.getByRole("button", { name: "New note", exact: true }).click();
  await expect(tree(b).getByRole("treeitem", { name: "Untitled" })).toBeVisible();
});

test("edits made in two tabs at once are merged, not overwritten", async ({ context }) => {
  const a = await context.newPage();
  await openApp(a);
  const b = await context.newPage();
  await openApp(b);
  await source(a);
  await source(b);

  // Both type before either has saved: B saves first, then A saves onto B's change.
  await typeAfter(b, "**Bold**, *italic*", " (B)");
  await typeAfter(a, "# Welcome to noted-ai", " (A)");

  for (const page of [a, b]) {
    await expect(editor(page)).toContainText("# Welcome to noted-ai (A)");
    await expect(editor(page)).toContainText("`inline code`. (B)");
  }
});

test("when both tabs change the same line, the other version is kept as a copy", async ({ context }) => {
  const a = await context.newPage();
  await openApp(a);
  const b = await context.newPage();
  await openApp(b);
  await source(a);
  await source(b);

  await typeAfter(b, "# Welcome to noted-ai", " (B)");
  await typeAfter(a, "# Welcome to noted-ai", " (A)");

  await expect(a.getByRole("alert").filter({ hasText: "another window" })).toContainText('the other is kept as "Welcome (from another window)"');
  await expect(editor(a)).toContainText("# Welcome to noted-ai (A)");
  await expect(editor(b)).toContainText("# Welcome to noted-ai (A)");
  await tree(a).getByRole("treeitem", { name: "Welcome (from another window)" }).click();
  await expect(editor(a)).toContainText("# Welcome to noted-ai (B)");
});
