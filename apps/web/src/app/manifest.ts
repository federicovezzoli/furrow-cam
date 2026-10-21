import type { MetadataRoute } from "next";
import { getTranslator } from "@/lib/locale";

// Installable, not offline: no service worker (PRD-0001 non-goals).
// In the language of the browser that installs it (ADR-0054); the manifest is fetched without cookies.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslator();
  return {
    name: "Furrow CAM",
    short_name: "Furrow",
    description: t("Meta.description"),
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
