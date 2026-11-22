import { describe, expect, it } from "vitest";
import { evaluate, parseExpr, QueryError } from "./expr";

const fields: Record<string, unknown> = {
  status: "Active",
  due: "2026-11-20",
  priority: 2,
  tags: ["garden", "work"],
  reviewed: false,
  "file.name": "Plan",
};
const run = (src: string) => evaluate(parseExpr(src), (n) => fields[n], "2026-11-22");

describe("query expressions", () => {
  it("compare text, numbers and dates", () => {
    expect(run('status = "active"')).toBe(true);
    expect(run('status != "done"')).toBe(true);
    expect(run("priority >= 2")).toBe(true);
    expect(run('priority < "3"')).toBe(true);
    expect(run("due < date(today)")).toBe(true);
    expect(run("due >= date(yesterday)")).toBe(false);
    expect(run('due = date("2026-11-20")')).toBe(true);
    expect(run("date(tomorrow) = \"2026-11-23\"")).toBe(true);
  });
  it("combine with and, or, not and parentheses", () => {
    expect(run('status = "active" and !reviewed')).toBe(true);
    expect(run('status = "done" or (priority > 1 and reviewed = false)')).toBe(true);
    expect(run("!(priority > 1)")).toBe(false);
    expect(run("!missing")).toBe(true);
    expect(run("missing < 3")).toBe(false);
  });
  it("call functions, and match list values", () => {
    expect(run('contains(tags, "#garden")')).toBe(true);
    expect(run('contains(file.name, "pla")')).toBe(true);
    expect(run("length(tags) = 2")).toBe(true);
    expect(run('tags = "work"')).toBe(true);
    expect(run('lower(status) = "active"')).toBe(true);
  });
  it("explain mistakes", () => {
    expect(() => parseExpr('status = "open')).toThrow(QueryError);
    expect(() => parseExpr("status =")).toThrow("ends too soon");
    expect(() => parseExpr("explode(x)")).toThrow("Unknown function");
    expect(() => parseExpr("a b")).toThrow('Unexpected "b"');
  });
});
