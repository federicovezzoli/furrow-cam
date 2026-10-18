import type { Machine, ProjectDocument, Tool } from "@furrow/document";
import type * as React from "react";
import type { TourId } from "../onboarding/lib/tour";

/** Nothing when an action succeeded, else why it failed, for the user. */
export type ActionResult = { error: string } | undefined;

/** A tool in the user's library: its id, whether new operations start with it, and the tool. */
export type ToolChoice = { id: string; isDefault: boolean; tool: Tool };

/** A machine profile of the user's: its id and the machine, as a project snapshots it. */
export type MachineChoice = { id: string; machine: Machine };

/** A tool the form saved: its library id, and the tool as an operation snapshot. */
export type SavedTool = { id: string; tool: Tool };

/** Why the tool form's fields, or the form as a whole, couldn't be saved, for the user. */
export type ToolFormErrors = Partial<Record<keyof Tool | "form", string>>;

/** The STL files a project may hold (PRD-0005 S1). */
export type MeshLimits = { maxBytes: number; maxTriangles: number };

/** A saved version of the project, without its document; `error` says why it can't be restored. */
export type VersionRow = { id: string; label: string | null; createdAt: Date; error?: string };

/** A save's new saved time, or why it failed, for the user. */
export type SaveResult = { updatedAt: Date; error?: never } | { error: string };

/** The project's versions after an action on them, newest first, or why the action failed. */
export type VersionsResult = { versions: VersionRow[]; error?: never } | { error: string };

export type RestoreResult =
  | { document: ProjectDocument; updatedAt: Date; versions: VersionRow[]; error?: never }
  | { error: string };

/** A place outside the open workspace page that it links to. */
export type WorkspaceDestination =
  /** All projects. */
  | "projects"
  /** The tool library. */
  | "tools"
  /** A form for a new machine. */
  | "new-machine"
  /** The open project's workspace. */
  | "workspace"
  /** The open project's simulator. */
  | "simulator";

export type WorkspaceLinkProps = Omit<React.ComponentProps<"a">, "href"> & {
  to: WorkspaceDestination;
};

/**
 * Everything the workspace stores, loads or leaves through (ADR-0045), so it
 * runs on whatever the app keeps projects in: the web app's server, or files
 * on disk in the desktop app. Methods report failures as the server actions
 * do, with an `error` for the user.
 */
export type WorkspaceHost = {
  project: {
    id: string;
    name: string;
    /** The document as last saved, upgraded to the current schema version. */
    document: ProjectDocument;
    /** When `document` was saved; passed back to `save` for its conflict check. */
    savedAt: Date;
    /**
     * Whether `save` stores the project for good, so the top bar shows the
     * save status: true on the web; false where the user saves explicitly
     * (the desktop app, whose window shows unsaved changes instead).
     */
    autosaves: boolean;
    /** Saves `document` over the copy saved at `savedAt`. */
    save(document: ProjectDocument, savedAt: Date): Promise<SaveResult>;
  };
  /** The project's STL files, by SHA-256 (ADR-0029). */
  meshes: {
    /** Stores `file`; `uploaded` is `false` when the project already had it. */
    put(
      sha256: string,
      file: Blob,
    ): Promise<{ uploaded: boolean; error?: never } | { error: string }>;
    /** The file's bytes; throws an `Error` for the user if it can't be read. */
    get(sha256: string): Promise<ArrayBuffer>;
    /** Drops a stored file that an import then didn't use; never fails. */
    discard(sha256: string): Promise<void>;
  };
  /** The project's named versions (ADR-0028), or `null` where there are none. */
  versions: {
    list(): Promise<VersionsResult>;
    /** Saves the document saved at `savedAt` as a version. */
    create(label: string, savedAt: Date): Promise<VersionsResult>;
    rename(id: string, label: string): Promise<ActionResult>;
    delete(id: string): Promise<ActionResult>;
    /** Replaces the document saved at `savedAt` with version `id`, keeping it as a version first. */
    restore(id: string, savedAt: Date): Promise<RestoreResult>;
    /** Opens version `id` as a new project; `dateLabel` names an unlabelled one. */
    openAsProject(id: string, dateLabel: string): Promise<ActionResult>;
  } | null;
  /** The user's tool library and machines, offered for the project's operations and stock. */
  library: {
    tools: ToolChoice[];
    machines: MachineChoice[];
    /** Saves the tool form's fields as library tool `id`, or a new one when `null`. */
    saveTool(id: string | null, form: FormData): Promise<{ errors: ToolFormErrors } | SavedTool>;
  };
  settings: {
    /** Whose settings these are: tours finished meanwhile are remembered per account. */
    account: string;
    /** Whether the workspace tour was finished or skipped (PRD-0001 R22). */
    tourDone: boolean;
    /** Remembers that `tour` was seen. */
    finishTour(tour: TourId): Promise<void>;
  };
  navigation: {
    /** A link to `to`, rendered as an anchor. */
    Link: React.ComponentType<WorkspaceLinkProps>;
  };
  limits: {
    /** The STL files the project may hold, or `null` when STL import is off. */
    meshes: MeshLimits | null;
  };
};
