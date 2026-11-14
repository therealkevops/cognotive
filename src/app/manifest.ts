import type { MetadataRoute } from "next";

/** Makes the app installable (desktop and phone) as a standalone window. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "noted-ai",
    short_name: "noted-ai",
    description: "Markdown notes with a knowledge graph, drawings and GitHub sync.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6d5bd0",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
