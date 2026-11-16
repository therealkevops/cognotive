import { describe, expect, it } from "vitest";
import {
  fillName,
  insertIntoNote,
  noteFromTemplate,
  renderTemplate,
  STARTER_TEMPLATES,
  templateInputs,
  templateSettings,
} from "./templates";

const now = new Date(2026, 10, 16, 9, 5); // Monday 16 November 2026, 09:05
const ctx = (inputs: Record<string, string> = {}) => ({ title: "Kick-off", now, folder: "Meetings", inputs });

describe("templateInputs", () => {
  it("lists each prompt once, with defaults", () => {
    expect(templateInputs("{{input:Client}} {{ input:Status|Draft }} {{input:Client}} {{title}}")).toEqual([
      { label: "Client", default: "" },
      { label: "Status", default: "Draft" },
    ]);
  });
});

describe("renderTemplate", () => {
  it("fills fields, prompts and dates", () => {
    const r = renderTemplate(
      "# {{title}}\n{{date}} {{time}} {{date:dddd D MMMM}}\nIn {{folder}} for {{input:Client}}, {{input:Status|Draft}}\n",
      ctx({ Client: "Acme" }),
    );
    expect(r.body).toBe("# Kick-off\n2026-11-16 09:05 Monday 16 November\nIn Meetings for Acme, Draft\n");
    expect(r.cursor).toBeNull();
  });

  it("marks the cursor and removes the template's own settings from the properties", () => {
    const r = renderTemplate(
      '---\ntemplate-folder: Meetings\ntemplate-name: "{{date}} {{input:Topic}}"\ntags: [meeting]\nstatus: open\n---\n# {{title}}\n\n{{cursor}}\n',
      ctx(),
    );
    expect(r.frontmatter).toBe("---\ntags: [meeting]\nstatus: open\n---\n");
    expect(r.body).toBe("# Kick-off\n\n\n");
    expect(r.cursor).toBe("# Kick-off\n\n".length);
    const note = noteFromTemplate(r);
    expect(note.content.slice(note.cursor)).toBe("\n");
  });

  it("drops the properties block when only settings were in it", () => {
    const r = renderTemplate("---\ntemplate-folder: X\n---\nBody", ctx());
    expect(r.frontmatter).toBe("");
    expect(noteFromTemplate(r)).toEqual({ content: "Body", cursor: 4 });
  });
});

describe("templateSettings and fillName", () => {
  it("reads where notes go and how they're named", () => {
    expect(templateSettings(STARTER_TEMPLATES["Meeting.md"])).toEqual({
      folder: "Meetings",
      name: "{{date}} {{input:Meeting about}}",
    });
    expect(templateSettings("# plain")).toEqual({ folder: null, name: null });
  });

  it("fills a name pattern and strips characters a file name can't have", () => {
    expect(fillName("{{date}} {{input:Topic}}", { now, folder: "", inputs: { Topic: "Q4/Q1 plan: draft?" } })).toBe(
      "2026-11-16 Q4 Q1 plan draft",
    );
  });
});

describe("insertIntoNote", () => {
  const r = renderTemplate("---\ntags: [meeting]\nowner: me\n---\n## Agenda\n- {{cursor}}\n", ctx());

  it("inserts at the cursor and adds the template's properties to a note without any", () => {
    const out = insertIntoNote("Intro\n", 6, r);
    expect(out.text).toBe("---\ntags: [meeting]\nowner: me\n---\nIntro\n## Agenda\n- \n");
    expect(out.text.slice(0, out.cursor).endsWith("- ")).toBe(true);
  });

  it("adds only missing properties to existing frontmatter", () => {
    const note = "---\ntags: [work]\n---\nBody\n";
    const out = insertIntoNote(note, note.length, r);
    expect(out.text).toBe("---\ntags: [work]\nowner: me\n---\nBody\n## Agenda\n- \n");
    expect(out.text.slice(0, out.cursor).endsWith("- ")).toBe(true);
  });

  it("never inserts inside the frontmatter", () => {
    const note = "---\na: 1\n---\nBody";
    const out = insertIntoNote(note, 2, renderTemplate("X", ctx()));
    expect(out.text).toBe("---\na: 1\n---\nXBody");
  });
});

describe("starter templates", () => {
  it("all render without leftover fields", () => {
    for (const [name, text] of Object.entries(STARTER_TEMPLATES)) {
      const inputs = Object.fromEntries(templateInputs(text).map((i) => [i.label, "x"]));
      const r = renderTemplate(text, { ...ctx(inputs), title: name });
      expect(r.frontmatter + r.body, name).not.toMatch(/\{\{/);
      expect(r.frontmatter, name).not.toContain("template-");
    }
  });
});
