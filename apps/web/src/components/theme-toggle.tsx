"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const THEMES = [
  { value: "system", label: "System theme", Icon: MonitorIcon },
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
] as const;

const subscribe = () => () => {};

/** Cycles between the system, light and dark themes. */
export function ThemeToggle({ size = "icon-sm" }: { size?: "icon-sm" | "icon-compact" }) {
  const { theme, setTheme } = useTheme();
  // The chosen theme is only known in the browser; render the system icon until then.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const index = mounted
    ? Math.max(
        0,
        THEMES.findIndex((t) => t.value === theme),
      )
    : 0;
  const current = THEMES[index] ?? THEMES[0];
  const next = THEMES[(index + 1) % THEMES.length] ?? THEMES[0];

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={() => setTheme(next.value)}
      aria-label={`${current.label}. Switch to ${next.label.toLowerCase()}`}
      title={`${current.label} (click for ${next.label.toLowerCase()})`}
    >
      <current.Icon />
    </Button>
  );
}
