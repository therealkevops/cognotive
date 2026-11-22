import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { ErrorBoundary } from "./ErrorBoundary";

let broken = true;
function Fragile({ label = "fine" }: { label?: string }) {
  if (broken) throw new Error("bad block");
  return <p>{label}</p>;
}

beforeEach(() => {
  broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("replaces a failed part with a message, and tries again on request", () => {
    render(
      <ErrorBoundary name="The editor">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The editor hit a problem and stopped.");
    expect(screen.getByRole("alert")).toHaveTextContent("bad block");
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("starts again by itself when its key changes", () => {
    const { rerender } = render(
      <ErrorBoundary name="The editor" resetKey="a.md">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    broken = false;
    rerender(
      <ErrorBoundary name="The editor" resetKey="b.md">
        <Fragile label="b" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("offers a way out of a failed dialog", () => {
    const onClose = vi.fn();
    render(
      <ErrorBoundary name="Settings" onClose={onClose}>
        <Fragile />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the rest of the layout working when one pane fails", () => {
    render(
      <AppShell sidebar={<p>files</p>} panel={<Fragile />}>
        <p>editor</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("editor");
    expect(screen.getByRole("complementary", { name: "Repository" })).toHaveTextContent("files");
    expect(screen.getByRole("complementary", { name: "Context" })).toHaveTextContent("The side panel hit a problem");
  });
});
