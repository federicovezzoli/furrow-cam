"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "use-intl";
import { useIsClient } from "../hooks/use-is-client";
import { Button } from "./ui/button";

const THEMES = [
  { value: "system", Icon: MonitorIcon },
  { value: "light", Icon: SunIcon },
  { value: "dark", Icon: MoonIcon },
] as const;

/** Cycles between the system, light and dark themes. */
export function ThemeToggle({ size = "icon-sm" }: { size?: "icon-sm" | "icon-compact" }) {
  const t = useTranslations("ThemeToggle");
  const { theme, setTheme } = useTheme();
  // The chosen theme is only known in the browser; render the system icon until then.
  const isClient = useIsClient();
  const index = isClient
    ? Math.max(
        0,
        THEMES.findIndex((t) => t.value === theme),
      )
    : 0;
  const current = THEMES[index] as (typeof THEMES)[number];
  const next = THEMES[(index + 1) % THEMES.length] as (typeof THEMES)[number];
  const label = `${t(current.value)}. ${t("switchTo", { theme: next.value })}`;

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={() => setTheme(next.value)}
      aria-label={label}
      title={label}
    >
      <current.Icon />
    </Button>
  );
}
