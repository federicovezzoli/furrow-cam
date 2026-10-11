import { z } from "zod";

/**
 * Workspace panel sizes, kept in a cookie so the server renders the panels at
 * the remembered sizes (localStorage would only apply after hydration, making
 * them jump). Not personal data (ADR-0013): just percentages per panel.
 */
export const WORKSPACE_LAYOUT_COOKIE = "furrow-workspace-layout";

/** Panel id → size in percent of its group, as react-resizable-panels reports it. */
const PanelLayout = z.record(z.string(), z.number().min(0).max(100));

const WorkspaceLayout = z.object({
  columns: PanelLayout.optional(),
  sidebar: PanelLayout.optional(),
});

export type WorkspaceLayout = z.infer<typeof WorkspaceLayout>;

/** The layout stored in the cookie, or `{}` if it's missing or unreadable. */
export function parseWorkspaceLayout(cookie: string | undefined): WorkspaceLayout {
  if (!cookie) return {};
  try {
    const result = WorkspaceLayout.safeParse(JSON.parse(cookie));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Stores `layout` for the next page load. Browser only. */
export function saveWorkspaceLayout(layout: WorkspaceLayout) {
  // biome-ignore lint/suspicious/noDocumentCookie: one cookie, written synchronously on resize; the Cookie Store API isn't in every browser yet.
  document.cookie = `${WORKSPACE_LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(layout))}; path=/projects; max-age=${ONE_YEAR}; samesite=lax`;
}
