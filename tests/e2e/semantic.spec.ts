import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";

const editor = (page: Page) => page.locator(".cm-content");

async function turnOn(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Search" }).click();
  const section = page.getByRole("region", { name: "Search" });
  await section.getByRole("switch", { name: "Search by meaning" }).click();
  return section;
}

async function addNote(page: Page, text: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Untitled");
  await editor(page).click();
  await page.keyboard.insertText(text);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test.describe("with the test engine", () => {
  // Words hashed into vectors: no model to download, and it matches word stems the keyword search misses.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("noted-ai:semanticEngine", JSON.stringify("hash")));
  });

  test("search finds notes by meaning as well as by words, and Connections shows similar notes", async ({ page }) => {
    await page.goto("/");
    await expect(editor(page)).toBeVisible();
    await addNote(page, "# Garden routine\n\nWater the plants before breakfast. Weed the beds on Sundays.\n");
    await addNote(page, "# Allotment\n\nThe plants on the allotment need water and weeding.\n");

    // Off: the search panel offers it.
    await page.getByRole("tab", { name: "Search" }).click();
    const search = page.getByRole("region", { name: "Search" });
    await search.getByLabel("Search all notes").fill("watering plants");
    await expect(search).toContainText("No matches");
    await expect(search.getByRole("button", { name: "Turn it on" })).toBeVisible();

    const settings = await turnOn(page);
    await expect(settings.getByRole("status", { name: "Search by meaning status" })).toContainText(/Ready: \d+ notes indexed/);
    await page.getByRole("button", { name: "Close settings" }).click();

    // Different word forms: found by meaning, and labelled so.
    await expect(search.getByRole("button", { name: /Garden routine/ })).toContainText("by meaning");
    await search.getByRole("button", { name: /Garden routine/ }).click();
    await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(/Untitled/);
    await expect(editor(page)).toContainText("Water the plants before breakfast");

    // Connections: the other garden note is close in meaning, and not linked.
    await page.getByRole("tab", { name: "Connections" }).click();
    const similar = page.getByRole("region", { name: "Similar in meaning" });
    await expect(similar.getByRole("button", { name: /Untitled/ })).toBeVisible();
    await expect(similar).toContainText("allotment");
  });

  test("the agent's search finds notes by meaning", async ({ page }) => {
    const llm = new FakeLLM();
    await llm.install(page);
    await page.goto("/");
    await expect(editor(page)).toBeVisible();
    await addNote(page, "# Garden routine\n\nWater the plants before breakfast.\n");
    const settings = await turnOn(page);
    await expect(settings.getByRole("status", { name: "Search by meaning status" })).toContainText("Ready");
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
    const ai = page.getByRole("region", { name: "AI" });
    await ai.getByLabel("API key").fill("sk-or-v1-good-key-0123456789abcdefghij");
    await ai.getByRole("button", { name: "Save key" }).click();
    await expect(ai.getByRole("listbox", { name: "Models" }).getByRole("option", { selected: true })).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();

    llm.script = [{ calls: [{ name: "search_notes", args: { query: "watering" } }] }, "Done."];
    await page.getByRole("tab", { name: "Chat" }).click();
    const chat = page.getByRole("region", { name: "Chat" });
    await chat.getByLabel("Message").fill("When do I water?");
    await chat.getByLabel("Message").press("Enter");
    await expect(chat.locator('[data-role="assistant"]').last()).toContainText("Done.");
    const result = JSON.parse(llm.calls[1].messages.find((m) => m.role === "tool")!.content);
    expect(result.results[0]).toMatchObject({ title: "Untitled", matched: "by meaning" });
  });
});

// The real model, served by the app (downloaded into public/models by the build).
test("the real model indexes in the browser and matches different wording", async ({ page }) => {
  test.skip(!fs.existsSync("public/models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx"), "model not downloaded");
  test.setTimeout(120_000);
  const external: string[] = [];
  page.on("request", (r) => !r.url().startsWith("http://localhost") && !r.url().startsWith("data:") && !r.url().startsWith("blob:") && external.push(r.url()));
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await addNote(page, "# Vegetable beds\n\nIrrigate the vegetable beds every Tuesday and Friday morning.\n");
  const settings = await turnOn(page);
  await expect(settings.getByRole("status", { name: "Search by meaning status" })).toContainText("Ready", { timeout: 90_000 });
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("tab", { name: "Search" }).click();
  const search = page.getByRole("region", { name: "Search" });
  await search.getByLabel("Search all notes").fill("watering schedule for the garden");
  await expect(search.getByRole("button", { name: /Untitled/ })).toContainText("by meaning", { timeout: 30_000 });
  // Everything came from the app itself: no CDN, no Hugging Face.
  expect(external).toEqual([]);
});
