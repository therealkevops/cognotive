/**
 * Points Excalidraw at the fonts this app serves (copied to /excalidraw/fonts
 * at build time) instead of a public CDN. Import before loading Excalidraw.
 */
if (typeof window !== "undefined") {
  const w = window as unknown as { EXCALIDRAW_ASSET_PATH?: string; EXCALIDRAW_EXPORT_SOURCE?: string };
  w.EXCALIDRAW_ASSET_PATH = "/excalidraw/";
  // The "source" written into files: stable across deployments (preview URLs would churn it).
  w.EXCALIDRAW_EXPORT_SOURCE = "Cognotive.ai";
}

export {};
