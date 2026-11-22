import { strToU8, zipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { editor, title, tree } from "./helpers";

/** Creates and opens a new local repository, with or without the starter templates. */
async function newRepository(page: Page, name: string, starters: boolean) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  await dialog.getByRole("button", { name: "New local repository" }).click();
  const form = dialog.getByRole("form", { name: "New local repository" });
  await form.getByLabel("Name").fill(name);
  const option = form.getByLabel(/Add starter templates/);
  await expect(option).toBeChecked();
  if (!starters) await option.uncheck();
  await form.getByRole("button", { name: "Create and open" }).click();
  await expect(dialog).toBeHidden();
}

async function openTemplates(page: Page) {
  await page.getByRole("tab", { name: "Templates" }).click();
  return page.getByRole("region", { name: "Templates" });
}

test("a new repository can start with templates, and a note is made from one", async ({ page }) => {
  await newRepository(page, "Work", true);
  const panel = await openTemplates(page);
  for (const t of ["Daily", "Meeting", "Person", "Project", "Weekly review"]) {
    await expect(panel.getByRole("button", { name: `New note from ${t}` })).toBeVisible();
  }

  await panel.getByRole("button", { name: "New note from Meeting" }).click();
  const dialog = page.getByRole("dialog", { name: "New note from Meeting" });
  await expect(dialog.getByLabel("Folder")).toHaveValue("Meetings");
  await dialog.getByLabel("Meeting about").fill("Budget");
  await dialog.getByLabel("Who's there").fill("Sam");
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await expect(dialog.getByLabel("Name")).toHaveValue(`${ymd} Budget`);
  await dialog.getByRole("button", { name: "Create note" }).click();

  await expect(title(page)).toHaveValue(`${ymd} Budget`);
  // The cursor starts at the first agenda item.
  await expect(page.locator(".cm-focused")).toBeVisible();
  await page.keyboard.type("Numbers");
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(tree(page).getByRole("treeitem", { name: "Meetings" })).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  const text = await editor(page).innerText();
  expect(text).toContain("tags: [meeting]");
  expect(text).not.toContain("template-folder");
  expect(text).toContain("# Budget");
  expect(text).toContain("**With:** Sam");
  expect(text).toContain("- Numbers");
});

test("today's note uses the Daily starter template", async ({ page }) => {
  await newRepository(page, "Journal", true);
  await expect(page.getByRole("tab", { name: "Templates" })).toBeVisible();
  await (await openTemplates(page)).getByRole("button", { name: "New note from Daily" }).waitFor();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(title(page)).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(editor(page)).toContainText("Plan");
  await expect(page.locator(".cm-focused")).toBeVisible();
  await page.keyboard.type("Write the report");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText("## Plan- [ ] Write the report");
});

test("without starter templates, the panel explains and can add them later", async ({ page }) => {
  await newRepository(page, "Empty", false);
  const panel = await openTemplates(page);
  await expect(panel).toContainText("Templates are notes in the Templates folder");
  await panel.getByRole("button", { name: "Add starter templates" }).click();
  await expect(panel.getByRole("button", { name: "New note from Project" })).toBeVisible();
});

test("a template with prompts can be inserted into the open note", async ({ page }) => {
  await newRepository(page, "Notes", true);
  const panel = await openTemplates(page);
  await panel.getByRole("button", { name: "New note from Person" }).waitFor();
  await page.getByRole("tab", { name: "Files" }).click();
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  await expect(title(page)).toHaveValue("Untitled");
  await title(page).fill("Alex");
  await title(page).press("Enter");
  await editor(page).click();
  await page.keyboard.type("Intro\n");
  await page.getByRole("tab", { name: "Templates" }).click();
  await panel.getByRole("button", { name: "New note from Person" }).hover();
  await panel.getByRole("button", { name: "Insert Person here" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert Person" });
  await dialog.getByLabel("Role").fill("Designer");
  await dialog.getByRole("button", { name: "Insert" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  const text = await editor(page).innerText();
  expect(text).toMatch(/^---\s*tags: \[person\]\s*---/);
  expect(text).toContain("Intro");
  expect(text).toContain("# Alex");
  expect(text).toContain("**Role:** Designer");
});

test("new notes start with the properties chosen in settings", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "This repository" }).click();
  const section = page.getByRole("region", { name: "This repository" });
  await section.getByLabel(/^created/).check();
  await section.getByLabel(/^tags/).check();
  await section.getByLabel("Add a property").fill("bad name");
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("letters, numbers");
  await section.getByLabel("Add a property").fill("status");
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect(section.getByRole("list", { name: "Your properties" })).toContainText("status");
  await expect(section.getByLabel("New notes start with")).toContainText("tags: []\nstatus:");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).locator(".cm-line").last().click();
  await page.keyboard.type("Hello");
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await expect(editor(page)).toHaveText(`---created: ${stamp}tags: []status:---Hello`);

  // A note from a template keeps the template's tags, gains the rest, and the cursor still lands at {{cursor}}.
  await page.getByRole("radio", { name: "Live preview" }).click();
  const zip = zipSync({ "V/Templates/Idea.md": strToU8("---\ntags: [idea]\n---\n# {{title}}\n\n{{cursor}}\n\nend\n") });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "t.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 1 file" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("new note from template");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "New note from template" }).getByRole("option", { name: /Idea/ }).click();
  const create = page.getByRole("dialog", { name: "New note from Idea" });
  await create.getByLabel(/Name/).fill("Plan");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(title(page)).toHaveValue("Plan");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("typed here");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toHaveText(`---tags: [idea]created: ${stamp}status:---# Plantyped hereend`);
});
