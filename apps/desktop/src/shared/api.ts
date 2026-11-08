import type { Locale } from "@furrow/ui/lib/locales";
import type { TelemetryEvent } from "@furrow/workspace/lib/telemetry";

/**
 * What the preload script exposes to the renderer as `window.furrow`
 * (ADR-0044): the only way the app reaches the disk. Paths are absolute.
 */

/**
 * What tells whether a project file changed since the app read or wrote it
 * (#491), e.g. because an assistant saved it through the MCP server: given
 * back when saving over the file. `null` if the file didn't exist.
 */
export type FileStamp = string | null;

/** A file the user opened: where it is, the name to show, its bytes and its stamp when read. */
export type OpenedFile = { path: string; name: string; bytes: Uint8Array; stamp: FileStamp };

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
  /** The project file's stamp as last read or written; absent for copies older than #491. */
  stamp?: FileStamp;
};

/** The JSON files kept in the app's data folder. */
export type DataFile = "tools" | "machines" | "settings";

/** What the user chose when asked about unsaved changes. */
export type UnsavedChoice = "save" | "discard" | "cancel";

/** What the user chose when the open project's file changed while they had unsaved changes. */
export type ReloadChoice = "reload" | "keep";

/** A command from the application menu. */
export type MenuCommand = "new" | "open" | "save" | "save-as" | "close" | "licences";

export type FileResult<T> = T | { error: string };

export interface DesktopApi {
  /** Shows the open dialog and reads the chosen file; `null` when cancelled. */
  openFile(): Promise<FileResult<OpenedFile> | null>;
  /** Reads the project file at `path`, e.g. a recent one. */
  readFile(path: string): Promise<FileResult<OpenedFile>>;
  /**
   * Writes `bytes` to `path`, or where the user picks in a save dialog
   * (starting at `suggestedName`, next to `path` if there is one) when
   * `path` is `null`. If the file at `path` isn't what `stamp` says it was,
   * asks first: replace it, save elsewhere or cancel; an `undefined` stamp
   * isn't checked. Returns where it was saved and its new stamp, or `null`
   * when cancelled.
   */
  saveFile(
    path: string | null,
    suggestedName: string,
    bytes: Uint8Array,
    stamp?: FileStamp,
  ): Promise<FileResult<RecentFile & { stamp: FileStamp }> | null>;
  recentFiles(): Promise<RecentFile[]>;
  /** Lists `path` first among the recent files, once the renderer has opened it as a project (#494). */
  addRecent(path: string): Promise<void>;
  /** Takes `path` off the recent files, leaving the file itself; returns the new list. */
  removeRecent(path: string): Promise<RecentFile[]>;
  /** A data file's JSON, or `null` if it doesn't exist yet. */
  readData(file: DataFile): Promise<unknown>;
  writeData(file: DataFile, data: unknown): Promise<void>;
  writeRecovery(recovery: Omit<Recovery, "savedAt">, bytes: Uint8Array): Promise<void>;
  deleteRecovery(id: string): Promise<void>;
  listRecoveries(): Promise<Recovery[]>;
  readRecovery(id: string): Promise<Uint8Array | null>;
  /** Asks whether to save the changes to `name` before they're lost. */
  askUnsaved(name: string): Promise<UnsavedChoice>;
  /** Asks whether to load `name`'s file, which another program changed, over the unsaved changes. */
  askReload(name: string): Promise<ReloadChoice>;
  /** Shows the open project in the window title, marked when it has unsaved changes. */
  setWindowState(state: { title: string; path: string | null; modified: boolean }): void;
  /** Closes the window (or quits, when quitting) after the renderer handled unsaved changes. */
  closeWindow(): void;
  /** Files the app was asked to open (double-click, command line) before the renderer listened. */
  takePendingPaths(): Promise<string[]>;
  onMenu(listener: (command: MenuCommand) => void): () => void;
  onOpenPath(listener: (path: string) => void): () => void;
  /**
   * The open project's file (the `path` given to `setWindowState`) changed
   * and is now `stamp`, e.g. an assistant saved it (#492), or this app did.
   */
  onFileChanged(listener: (path: string, stamp: FileStamp) => void): () => void;
  /** Hands a usage event to the main process, which sends it if the user agreed (ADR-0052). */
  trackEvent(event: TelemetryEvent): void;
  /** Hands an error report (from `reportableError`) to the main process, as `trackEvent`. */
  reportError(error: { name: string; message: string; stack?: string }): void;
  /** The interface language: the one picked in the app, else the system's (ADR-0054). */
  getLocale(): Promise<Locale>;
  /** Remembers `locale` as the interface language, over the system's. */
  setLocale(locale: Locale): Promise<void>;
  /** The terrain dialog opened (`true`) or closed: its services are let through only meanwhile. Resolves once they are. */
  setTerrainServices(open: boolean): Promise<void>;
  /** The window is closing with unsaved changes; call `closeWindow` once they're handled. */
  onCloseRequest(listener: () => void): () => void;
}

/** IPC channel names, shared by the main process and the preload script. */
export const CHANNELS = {
  openFile: "file:open",
  readFile: "file:read",
  saveFile: "file:save",
  recentFiles: "file:recent",
  addRecent: "file:recent-add",
  removeRecent: "file:recent-remove",
  readData: "data:read",
  writeData: "data:write",
  writeRecovery: "recovery:write",
  deleteRecovery: "recovery:delete",
  listRecoveries: "recovery:list",
  readRecovery: "recovery:read",
  askUnsaved: "window:ask-unsaved",
  askReload: "window:ask-reload",
  setWindowState: "window:state",
  closeWindow: "window:close",
  takePendingPaths: "app:pending-paths",
  trackEvent: "telemetry:event",
  reportError: "telemetry:error",
  getLocale: "locale:get",
  setLocale: "locale:set",
  setTerrainServices: "terrain:services",
  menu: "menu",
  openPath: "app:open-path",
  fileChanged: "file:changed",
  closeRequest: "window:close-request",
} as const;

/** The project file extensions the app opens; it saves `.furrow` (ADR-0047). */
export const OPEN_EXTENSIONS = ["furrow", "zip", "json"] as const;
