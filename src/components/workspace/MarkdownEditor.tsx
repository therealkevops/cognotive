"use client";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { editorExtensions, livePreviewExtension, livePreviewMode } from "@/lib/editor/setup";
import type { LinkHost } from "@/lib/editor/wikilinks";

export interface MarkdownEditorProps {
  /** Identifies the document; when it changes the editor reloads `initial`. */
  docKey: string;
  initial: string;
  livePreview: boolean;
  onChange(text: string): void;
  /** Receives the view once created (and null on unmount), for toolbar commands. */
  onView?(view: EditorView | null): void;
  autoFocus?: boolean;
  /** Link resolution, opening and completion. May change between renders. */
  links?: LinkHost;
}

/** CodeMirror 6 markdown editor. Uncontrolled: it owns the text after loading `initial`. */
export default function MarkdownEditor({
  docKey,
  initial,
  livePreview,
  onChange,
  onView,
  autoFocus,
  links,
}: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const livePreviewRef = useRef(livePreview);

  const linksRef = useRef(links);
  useEffect(() => {
    onChangeRef.current = onChange;
    linksRef.current = links;
  }, [onChange, links]);

  // A stable host that always calls the latest `links`, so the editor needn't be rebuilt.
  const linkHostProxy = useMemo<LinkHost>(
    () => ({
      resolve: (t) => linksRef.current?.resolve(t) ?? null,
      open: (t, h, how) => linksRef.current?.open(t, h, how),
      clickFollows: () => linksRef.current?.clickFollows?.() ?? true,
      linkText: (p) => (linksRef.current?.linkText ? linksRef.current.linkText(p) : p.replace(/\.md$/i, "")),
      linkSelection: () => linksRef.current?.linkSelection?.(),
      currentPath: () => linksRef.current?.currentPath?.() ?? null,
      formatLink: (inner, embed) => linksRef.current?.formatLink?.(inner, embed) ?? null,
      noteContent: (p) => linksRef.current?.noteContent?.(p),
      addBlockId: (p, b, id) => linksRef.current?.addBlockId?.(p, b, id),
      notes: () => linksRef.current?.notes() ?? [],
      headings: (p) => linksRef.current?.headings(p) ?? [],
      notePreview: (t, sub) => linksRef.current?.notePreview?.(t, sub) ?? null,
      hoverPreview: () => linksRef.current?.hoverPreview?.() ?? "always",
      embedPath: (t) => linksRef.current?.embedPath?.(t) ?? null,
      fileUrl: async (p) => (await linksRef.current?.fileUrl?.(p)) ?? null,
      saveFiles: async (f) => (await linksRef.current?.saveFiles?.(f)) ?? [],
      renderHtml: async (md) => (await linksRef.current?.renderHtml?.(md)) ?? "",
      noteEmbed: (t) => linksRef.current?.noteEmbed?.(t) ?? null,
    }),
    [],
  );

  // Create the view once.
  useEffect(() => {
    const v = new EditorView({ parent: host.current! });
    view.current = v;
    onView?.(v);
    return () => {
      onView?.(null);
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once
  }, []);

  // Load a document: a fresh state so undo history doesn't cross notes.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.setState(
      EditorState.create({
        doc: initial,
        extensions: editorExtensions({
          livePreview: livePreviewRef.current,
          onChange: (text) => onChangeRef.current(text),
          links: linkHostProxy,
        }),
      }),
    );
    // A new note starts at the top, not at the previous note's scroll position.
    v.dispatch({ effects: EditorView.scrollIntoView(0, { y: "start" }) });
    v.scrollDOM.scrollTop = 0;
    if (autoFocus) v.focus();
    // `initial` is read only when docKey changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  useEffect(() => {
    livePreviewRef.current = livePreview;
    view.current?.dispatch({
      effects: livePreviewMode.reconfigure(livePreviewExtension(livePreview)),
    });
  }, [livePreview]);

  return <div ref={host} className="h-full" data-testid="editor" />;
}
