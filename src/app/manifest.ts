import type { MetadataRoute } from "next";

/**
 * Makes the app installable (desktop and phone) as its own window. The
 * shortcuts appear when you right-click (desktop) or long-press (Android) the
 * installed app's icon; each opens the app with ?action=… (see Workspace).
 */
export default function manifest(): MetadataRoute.Manifest {
  const icon = [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }];
  return {
    id: "/",
    name: "noted-ai",
    short_name: "noted-ai",
    description: "Markdown notes with a knowledge graph, drawings, canvases and GitHub sync.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#faf9f5",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "New note", url: "/?action=new-note", icons: icon },
      { name: "Today's note", short_name: "Today", url: "/?action=daily", icons: icon },
      { name: "Search notes", short_name: "Search", url: "/?action=search", icons: icon },
      { name: "New canvas", url: "/?action=new-canvas", icons: icon },
    ],
    // Opening the app (or a shortcut) again reuses the open window instead of starting another.
    launch_handler: { client_mode: ["focus-existing", "auto"] },
  } as MetadataRoute.Manifest;
}
