/** A picture of the viewport for a bug report, and the GPU it was drawn with. */
export type ViewportCapture = { screenshot: Promise<Blob | null>; renderer: string };

// shortcut: one viewport on the page at a time; two open workspaces would need this per store.
let current: (() => ViewportCapture) | null = null;

/** Makes `capture` the viewport's; the returned function undoes it. */
export function setViewportCapture(capture: () => ViewportCapture): () => void {
  current = capture;
  return () => {
    if (current === capture) current = null;
  };
}

/** Captures the viewport on the page, or `null` when there is none. */
export function captureViewport(): ViewportCapture | null {
  return current?.() ?? null;
}
