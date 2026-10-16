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

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Stores `layout` for the next page load. Browser only. */
export function saveWorkspaceLayout(layout: WorkspaceLayout) {
  // biome-ignore lint/suspicious/noDocumentCookie: one cookie, written synchronously on resize; the Cookie Store API isn't in every browser yet.
  document.cookie = `${WORKSPACE_LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(layout))}; path=/projects; max-age=${ONE_YEAR}; samesite=lax`;
}

/** Panel id → size in percent, as react-resizable-panels reports it. */
type Sizes = Record<string, number>;

/**
 * The sidebar's sizes after its header toggled pane `target`, from `layout`.
 * Panes `panes` (top to bottom) above a `rest` panel fill the sidebar;
 * `collapsed` are those collapsed in `layout`, at `headerSize`. Toggling never
 * opens or closes another pane: a collapsing pane gives its space to the
 * nearest open pane, below first, or to `rest` when none is open. An expanding
 * pane fills the sidebar when it's the only open one; otherwise it grows back
 * to `openSize`, first from `rest`, then from the open panes, none shrinking
 * below `minSize`.
 */
export function toggledPaneLayout({
  layout,
  panes,
  rest,
  collapsed,
  target,
  headerSize,
  openSize,
  minSize,
}: {
  layout: Sizes;
  panes: string[];
  rest: string;
  collapsed: ReadonlySet<string>;
  target: string;
  headerSize: number;
  openSize: number;
  minSize: number;
}): Sizes {
  const next = { ...layout };
  const size = (id: string) => next[id] ?? 0;
  const index = panes.indexOf(target);
  const open = panes.filter((id) => id !== target && !collapsed.has(id));

  if (!collapsed.has(target)) {
    const below = panes.slice(index + 1).find((id) => open.includes(id));
    const above = panes.slice(0, index).findLast((id) => open.includes(id));
    const recipient = below ?? above ?? rest;
    next[recipient] = size(recipient) + size(target) - headerSize;
    next[target] = headerSize;
    return next;
  }

  if (open.length === 0) {
    const headers = panes.reduce((sum, id) => (id === target ? sum : sum + size(id)), 0);
    return { ...next, [target]: 100 - headers, [rest]: 0 };
  }
  let needed = Math.max(0, openSize - size(target));
  const fromRest = Math.min(needed, size(rest));
  next[rest] = size(rest) - fromRest;
  needed -= fromRest;
  const spare = open.reduce((sum, id) => sum + Math.max(0, size(id) - minSize), 0);
  const share = spare > 0 ? Math.min(1, needed / spare) : 0;
  let taken = fromRest;
  for (const id of open) {
    const give = Math.max(0, size(id) - minSize) * share;
    next[id] = size(id) - give;
    taken += give;
  }
  next[target] = size(target) + taken;
  return next;
}
