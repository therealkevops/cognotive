import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";
import { editor, GOOD_KEY, tree } from "./helpers";

async function setUp(page: Page, llm: FakeLLM) {
  await llm.install(page);
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  const ai = page.getByRole("region", { name: "AI" });
  await ai.getByLabel("API key").fill(GOOD_KEY);
  await ai.getByRole("button", { name: "Save key" }).click();
  await expect(ai.getByRole("listbox", { name: "Models" }).getByRole("option", { selected: true })).toBeVisible();
  return ai;
}

async function ask(page: Page, question: string) {
  await page.getByRole("tab", { name: "Chat" }).click();
  const chat = page.getByRole("region", { name: "Chat" });
  await chat.getByLabel("Message").fill(question);
  await chat.getByLabel("Message").press("Enter");
  return chat;
}

test("the agent proposes changes; nothing changes until they're applied", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.script = [
    {
      calls: [
        { name: "create_note", args: { path: "Ideas/Garden", content: "# Garden\n\nTomatoes.", properties: { tags: ["garden"] } } },
        { name: "append_to_note", args: { path: "Welcome", text: "See also [[Garden]].", under_heading: "Formatting" } },
        { name: "set_property", args: { path: "Linking notes", key: "status", value: "reviewed" } },
      ],
    },
    "I proposed a Garden note, a link to it and a status.",
  ];
  const chat = await ask(page, "Start a garden note");
  const answer = chat.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText("I proposed a Garden note");
  // Write tools were offered alongside the read ones.
  expect(llm.calls[0].tools).toEqual(expect.arrayContaining(["create_note", "append_to_note", "edit_note", "set_property", "add_link", "search_notes"]));

  const changes = answer.getByRole("region", { name: "Proposed changes" });
  await expect(changes).toContainText("3 proposed changes");
  await expect(changes).toContainText("3 to review");
  const create = changes.getByRole("listitem", { name: "Create Garden" });
  await expect(create.getByLabel("Changes to Garden")).toContainText("+ tags: [garden]");
  const append = changes.getByRole("listitem", { name: "Add under “Formatting” in Welcome" });
  await expect(append.getByLabel("Changes to Welcome")).toContainText("+ See also [[Garden]].");
  // Nothing written yet.
  await expect(tree(page).getByRole("treeitem", { name: "Ideas" })).toHaveCount(0);
  await expect(editor(page)).not.toContainText("See also [[Garden]]");

  // Edit a proposal before applying it.
  await create.getByRole("button", { name: "Edit" }).click();
  await create.getByLabel("Edit the proposed text of Garden").fill("---\ntags: [garden]\n---\n# Garden\n\nTomatoes and beans.\n");
  await create.getByRole("button", { name: "Done editing" }).click();
  await expect(create.getByLabel("Changes to Garden")).toContainText("+ Tomatoes and beans.");

  // Reject one, apply the rest.
  await changes.getByRole("listitem", { name: /Set status of Linking notes/ }).getByRole("button", { name: "Reject" }).click();
  await expect(changes).toContainText("2 to review");
  await changes.getByRole("button", { name: "Apply all" }).click();
  await expect(changes).toContainText("all reviewed");
  await expect(create).toContainText("Applied");
  await expect(editor(page)).toContainText("See also [[Garden]].");
  await tree(page).getByRole("treeitem", { name: "Ideas" }).click();
  await tree(page).getByRole("treeitem", { name: "Garden" }).click();
  await expect(editor(page)).toContainText("Tomatoes and beans.");
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await expect(editor(page)).not.toContainText("status: reviewed");
});

test("a change that clashes with an edit made since isn't applied", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.script = [
    { calls: [{ name: "edit_note", args: { path: "Welcome", find: "# Welcome to CogNotive.ai", replace: "# Welcome, gardener" } }] },
    { calls: [{ name: "edit_note", args: { path: "Welcome", find: "## Formatting", replace: "## Formatting basics" } }] },
    "Done.",
  ];
  const chat = await ask(page, "Rename things");
  const changes = chat.getByRole("region", { name: "Proposed changes" });
  await expect(changes.getByRole("listitem")).toHaveCount(2);

  // Meanwhile, the title is edited by hand.
  await editor(page).getByText("# Welcome to CogNotive.ai").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(editor(page)).toContainText("# Welcome to CogNotive.ai!");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const [title, heading] = [changes.getByRole("listitem").nth(0), changes.getByRole("listitem").nth(1)];
  await title.getByRole("button", { name: "Apply" }).click();
  await expect(title.getByRole("alert")).toContainText("changed in the same place");
  // The other change merges onto the edit.
  await heading.getByRole("button", { name: "Apply" }).click();
  await expect(heading).toContainText("Applied");
  await expect(editor(page)).toContainText("# Welcome to CogNotive.ai!");
  await expect(editor(page)).toContainText("## Formatting basics");
});

test("save a chat as a note", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.script = [{ calls: [{ name: "read_note", args: { path: "Linking notes" } }] }, "Use [[Linking notes]]."];
  const chat = await ask(page, "How do links work?");
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("Use Linking notes.");
  await chat.getByRole("button", { name: "Save chat as a note" }).click();
  await expect(editor(page)).toContainText("# How do links work");
  await expect(editor(page)).toContainText("> How do links work?");
  await expect(editor(page)).toContainText("Sources: [[Welcome]], [[Linking notes]]");
  await expect(tree(page).getByRole("treeitem", { name: "AI" })).toBeVisible();
});

test("with proposals off, the agent only reads", async ({ page }) => {
  const llm = new FakeLLM();
  const ai = await setUp(page, llm);
  await ai.getByRole("switch", { name: "Let the model propose changes" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
  const chat = await ask(page, "Hello");
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("You asked");
  expect(llm.calls[0].tools).toContain("search_notes");
  expect(llm.calls[0].tools).not.toContain("create_note");
});

test("ask about a selection, and save the answer as a linked note", async ({ page }) => {
  const llm = new FakeLLM();
  await setUp(page, llm);
  await page.getByRole("button", { name: "Close settings" }).click();
  llm.reply = (call) => {
    const q = call.messages.at(-1)!.content;
    return q.includes("> This repository lives in your browser") ? "It means notes are stored **locally**." : "No passage seen.";
  };
  await editor(page).getByText("This repository lives in your browser.").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  const dialog = page.getByRole("dialog", { name: "Ask about the selection" });
  await expect(dialog.getByLabel("Selection")).toContainText("This repository lives in your browser.");
  await dialog.getByRole("button", { name: "Explain this" }).click();
  await expect(dialog.getByLabel("Answer")).toContainText("It means notes are stored locally.");
  await dialog.getByRole("button", { name: "Save as note" }).click();
  await expect(dialog).toBeHidden();
  // The passage now links to the new note in the AI folder.
  await expect(editor(page)).toContainText(
    "[[This repository lives in your browser|This repository lives in your browser. To sync your notes with GitHub instead, open]]",
  );
  await tree(page).getByRole("treeitem", { name: "AI" }).click();
  await tree(page).getByRole("treeitem", { name: "This repository lives in your browser" }).click();
  await expect(editor(page)).toContainText("It means notes are stored **locally**.");
  await expect(editor(page)).toContainText("From [[Welcome]]");
});
