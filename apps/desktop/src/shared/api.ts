import type { TelemetryEvent } from "@furrow/workspace/lib/telemetry";

/**
 * What the preload script exposes to the renderer as `window.furrow`
 * (ADR-0044): the only way the app reaches the disk. Paths are absolute.
 */

/** A file the user opened: where it is, the name to show and its bytes. */
export type OpenedFile = { path: string; name: string; bytes: Uint8Array };

/** A recently opened or saved project file. */
export type RecentFile = { path: string; name: string };

/** A crash-recovery copy left by a session that didn't end (ADR-0047). */
export type Recovery = {
  id: string;
  /** The project's file, or `null` for one never saved. */
  path: string | null;
  name: string;
  /** When the copy was written, as an ISO date. */
  savedAt: string;
};

/** The JSON files kept in the app's data folder. */
export type DataFile = "tools" | "machines" | "settings";

/** What the user chose when asked about unsaved changes. */
export type UnsavedChoice = "save" | "discard" | "cancel";

/** A command from the application menu. */
export type MenuCommand = "new" | "open" | "save" | "save-as" | "close";

export type FileResult<T> = T | { error: string };

export interface DesktopApi {
  /** Shows the open dialog and reads the chosen file; `null` when cancelled. */
  openFile(): Promise<FileResult<OpenedFile> | null>;
  /** Reads the project file at `path`, e.g. a recent one. */
  readFile(path: string): Promise<FileResult<OpenedFile>>;
  /**
   * Writes `bytes` to `path`, or where the user picks in a save dialog
   * (starting at `suggestedName`) when `path` is `null`. Returns where it
   * was saved, or `null` when the dialog was cancelled.
   */
  saveFile(
    path: string | null,
    suggestedName: string,
    bytes: Uint8Array,
  ): Promise<FileResult<RecentFile> | null>;
  recentFiles(): Promise<RecentFile[]>;
  /** A data file's JSON, or `null` if it doesn't exist yet. */
  readData(file: DataFile): Promise<unknown>;
  writeData(file: DataFile, data: unknown): Promise<void>;
  writeRecovery(recovery: Omit<Recovery, "savedAt">, bytes: Uint8Array): Promise<void>;
  deleteRecovery(id: string): Promise<void>;
  listRecoveries(): Promise<Recovery[]>;
  readRecovery(id: string): Promise<Uint8Array | null>;
  /** Asks whether to save the changes to `name` before they're lost. */
  askUnsaved(name: string): Promise<UnsavedChoice>;
  /** Shows the open project in the window title, marked when it has unsaved changes. */
  setWindowState(state: { title: string; path: string | null; modified: boolean }): void;
  /** Closes the window (or quits, when quitting) after the renderer handled unsaved changes. */
  closeWindow(): void;
  /** Files the app was asked to open (double-click, command line) before the renderer listened. */
  takePendingPaths(): Promise<string[]>;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onOpenPath(listener: (path: string) => void): () => void;
  /** Hands a usage event to the main process, which sends it if the user agreed (ADR-0052). */
  trackEvent(event: TelemetryEvent): void;
  /** Hands an error report (from `reportableError`) to the main process, as `trackEvent`. */
  reportError(error: { name: string; message: string; stack?: string }): void;
  /** The window is closing with unsaved changes; call `closeWindow` once they're handled. */
  onCloseRequest(listener: () => void): () => void;
}

/** IPC channel names, shared by the main process and the preload script. */
export const CHANNELS = {
  openFile: "file:open",
  readFile: "file:read",
  saveFile: "file:save",
  recentFiles: "file:recent",
  readData: "data:read",
  writeData: "data:write",
  writeRecovery: "recovery:write",
  deleteRecovery: "recovery:delete",
  listRecoveries: "recovery:list",
  readRecovery: "recovery:read",
  askUnsaved: "window:ask-unsaved",
  setWindowState: "window:state",
  closeWindow: "window:close",
  takePendingPaths: "app:pending-paths",
  trackEvent: "telemetry:event",
  reportError: "telemetry:error",
  menu: "menu",
  openPath: "app:open-path",
  closeRequest: "window:close-request",
} as const;

/** The project file extensions the app opens; it saves `.furrow` (ADR-0047). */
export const OPEN_EXTENSIONS = ["furrow", "zip", "json"] as const;
