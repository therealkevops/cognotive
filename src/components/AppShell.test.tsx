import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders the sidebar, main content and context panel", () => {
    render(
      <AppShell sidebar={<p>files</p>} panel={<p>outline</p>}>
        <p>editor</p>
      </AppShell>,
    );
    expect(screen.getByRole("complementary", { name: "Vault" })).toHaveTextContent("files");
    expect(screen.getByRole("main")).toHaveTextContent("editor");
    expect(screen.getByRole("complementary", { name: "Context" })).toHaveTextContent("outline");
  });
});

describe("AppShell rails", () => {
  it("shows rails instead of collapsed sidebars", () => {
    render(
      <AppShell
        sidebar={<p>files</p>}
        panel={<p>outline</p>}
        leftCollapsed
        rightCollapsed
        leftRail={<span>left icons</span>}
        rightRail={<span>right icons</span>}
      >
        <p>editor</p>
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "Vault rail" })).toHaveTextContent("left icons");
    expect(screen.getByRole("navigation", { name: "Context rail" })).toHaveTextContent("right icons");
    expect(screen.queryByRole("complementary", { name: "Context" })).toBeNull();
  });
});
