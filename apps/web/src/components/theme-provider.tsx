"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type * as React from "react";
import { useEffect } from "react";
import { themeColors } from "@/lib/theme-colors";

/** Light and dark themes (ADR-0009): follows the system setting until the user picks one. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}

/**
 * The layout's theme-color tags follow the system setting; point them all at the app's
 * resolved theme so the browser's title or status bar matches a theme picked in the app.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", themeColors[resolvedTheme]);
    }
  }, [resolvedTheme]);
  return null;
}
