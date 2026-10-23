import { z } from "zod";

/** Panel id → size in percent of its group, as react-resizable-panels reports it. */
const PanelLayout = z.record(z.string(), z.number().min(0).max(100));

const WorkspaceLayout = z.object({
  columns: PanelLayout.optional(),
});

/**
 * Workspace panel sizes, which the host remembers (`WorkspaceHost.settings`).
 * Not personal data (ADR-0013): just percentages per panel.
 */
export type WorkspaceLayout = z.infer<typeof WorkspaceLayout>;

/** `json` as a stored layout, or `{}` if it isn't one. */
export function toWorkspaceLayout(json: unknown): WorkspaceLayout {
  const result = WorkspaceLayout.safeParse(json);
  return result.success ? result.data : {};
}

/**
 * `layout` if it sizes exactly the panels `ids`, else nothing: a layout saved
 * before panels were added, removed or renamed doesn't fit the panels there are now.
 */
export function savedLayout(
  layout: Record<string, number> | undefined,
  ids: string[],
): Record<string, number> | undefined {
  if (!layout) return undefined;
  const keys = Object.keys(layout);
  return keys.length === ids.length && ids.every((id) => keys.includes(id)) ? layout : undefined;
}
