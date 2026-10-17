import type { MetadataRoute } from "next";

// Installable, not offline: no service worker (PRD-0001 non-goals).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Furrow CAM",
    short_name: "Furrow",
    description: "Open source, web-based 2.5D CAM for CNC routers.",
    // The proxy sends signed-out users to /sign-in.
    start_url: "/projects",
    display: "standalone",
    // The light theme's --background (globals.css).
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
