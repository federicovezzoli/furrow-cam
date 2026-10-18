import type { DesktopApi } from "../../shared/api";

declare global {
  interface Window {
    /** Exposed by the preload script (ADR-0044). */
    furrow: DesktopApi;
  }
}

/** The main process's file, window and menu API. */
export const api: DesktopApi = window.furrow;
