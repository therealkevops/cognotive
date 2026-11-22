"use client";

import { RotateCcw, TriangleAlert, X } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What this part of the app is, for the message: "The editor", "Settings"… */
  name: string;
  children: ReactNode;
  /** When this changes (say, another note is opened), the part tries again by itself. */
  resetKey?: unknown;
  /** For dialogs: a way out if trying again fails too. */
  onClose?(): void;
  /** Fills the screen (the whole app failed), with a reload button instead of "Try again". */
  page?: boolean;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/**
 * Keeps a failure in one part of the app (a panel, the editor, a dialog) from blanking
 * the rest. The part is replaced by a short message and a way to try again; edits are
 * saved by the vault, which sits above every boundary, so nothing typed is lost.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A different note (or whatever the key tracks): start again without the old error.
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} failed`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { name, onClose, page } = this.props;
    const body = (
      <div role="alert" className="m-3 rounded-lg border border-border bg-background p-4 text-sm shadow-sm">
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlert size={16} aria-hidden className="shrink-0 text-red-600" />
          {name} hit a problem and stopped.
        </p>
        <p className="mt-1 text-muted">
          {page
            ? "Your notes are saved in this browser. Reloading the app usually fixes this."
            : "Your notes are saved, and the rest of the app still works."}
        </p>
        <p className="mt-2 break-words font-mono text-xs text-muted">{error.message}</p>
        <div className="mt-3 flex gap-2">
          {page ? (
            <button type="button" className="button-primary px-3 py-1.5 text-xs" onClick={() => location.reload()}>
              <RotateCcw size={12} aria-hidden /> Reload
            </button>
          ) : (
            <button type="button" className="button-secondary px-3 py-1.5 text-xs" onClick={this.retry}>
              <RotateCcw size={12} aria-hidden /> Try again
            </button>
          )}
          {onClose && (
            <button type="button" className="button-secondary px-3 py-1.5 text-xs" onClick={onClose}>
              <X size={12} aria-hidden /> Close
            </button>
          )}
        </div>
      </div>
    );
    if (page) return <div className="mx-auto mt-16 max-w-lg px-4">{body}</div>;
    if (onClose)
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md">{body}</div>
        </div>
      );
    return body;
  }
}
