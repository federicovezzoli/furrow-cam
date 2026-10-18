import { toWorkspaceLayout, type WorkspaceLayout } from "@furrow/workspace/lib/workspace-layout";

/**
 * The workspace's panel sizes, kept in a cookie so the server renders the
 * panels at the remembered sizes (localStorage would only apply after
 * hydration, making them jump).
 */
export const WORKSPACE_LAYOUT_COOKIE = "furrow-workspace-layout";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** The layout stored in the cookie, or `{}` if it's missing or unreadable. */
export function parseLayoutCookie(cookie: string | undefined): WorkspaceLayout {
  if (!cookie) return {};
  try {
    return toWorkspaceLayout(JSON.parse(cookie));
  } catch {
    return {};
  }
}

/** Stores `layout` for the next page load. Browser only. */
export function writeLayoutCookie(layout: WorkspaceLayout) {
  // biome-ignore lint/suspicious/noDocumentCookie: one cookie, written synchronously on resize; the Cookie Store API isn't in every browser yet.
  document.cookie = `${WORKSPACE_LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(layout))}; path=/projects; max-age=${ONE_YEAR}; samesite=lax`;
}
