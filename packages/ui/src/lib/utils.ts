import { createCn } from "cn/config";

/**
 * Merges class names like `twMerge(clsx(...))`, knowing the workspace's theme
 * tokens (`--spacing-control*`, `--text-ui*` in globals.css). Without them,
 * `text-ui` reads as a text colour and drops `text-primary-foreground`, and
 * `h-control` doesn't give way to `h-auto`.
 */
export const cn = createCn({
  extend: { theme: { spacing: ["control", "control-sm"], text: ["ui", "ui-label"] } },
});
