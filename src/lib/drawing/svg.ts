/**
 * Renders a drawing to an SVG object URL, for embeds and previews. Loads the
 * Excalidraw library on first use (it's large), and only in the browser.
 */
export async function drawingToSvgUrl(json: string, dark: boolean): Promise<string | null> {
  const svg = await drawingToSvgText(json, dark);
  return svg ? URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) : null;
}

/** The drawing as standalone SVG markup (fonts inlined), or null if it isn't valid. */
export async function drawingToSvgText(json: string, dark: boolean): Promise<string | null> {
  let data: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  await import("./assets");
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    elements: (data.elements ?? []) as never,
    appState: {
      ...(data.appState ?? {}),
      exportBackground: true,
      exportWithDarkMode: dark,
      exportEmbedScene: false,
    } as never,
    files: (data.files ?? {}) as never,
    exportPadding: 16,
  });
  return svg.outerHTML;
}
