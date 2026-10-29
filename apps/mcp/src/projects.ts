import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import {
  type ArchiveVersion,
  createProjectDocument,
  PROJECT_DESKTOP_EXTENSION,
  ProjectArchiveError,
} from "@furrow/document";
import { formatMessage, translator } from "@furrow/ui/lib/i18n";
import { readProjectFile, writeProjectFile } from "@furrow/workspace/lib/project-file";
import { MAX_VERSIONS } from "@furrow/workspace/lib/versions";
import { createDocumentStore, type DocumentStore } from "@furrow/workspace/stores/document-store";
import { writeFileAtomic } from "./files";

/** The app's messages, in English: the server's results go to an assistant (ADR-0067). */
export const t = translator("en");

/** A request the server refuses, with a message for the assistant to act on. */
export class ToolError extends Error {
  override name = "ToolError";
}

/** The label of the version kept before an assistant's first change (ADR-0028). */
export const KEPT_VERSION_LABEL = "Before the assistant's changes";

/** An open project; it reaches its file only when saved. */
export type Project = {
  /** The `.furrow` file it saves to. */
  path: string;
  store: DocumentStore;
  meshes: Map<string, Uint8Array>;
  fonts: Map<string, Uint8Array>;
  versions: ArchiveVersion[];
  /** Whether nothing is left to keep before a change: the version was kept, or the project is new. */
  kept: boolean;
  /** Whether `path` is the project's own file, which saving may replace. */
  owned: boolean;
};

const PROJECT_PATH = /(\.furrow)?\.(json|zip)$|\.furrow$/i;

/** The `.furrow` file a project at `path` saves to; throws a `ToolError` for other paths. */
export function savePath(path: string): string {
  if (!isAbsolute(path)) throw new ToolError(`Give an absolute path, not ${JSON.stringify(path)}.`);
  if (!PROJECT_PATH.test(path)) {
    throw new ToolError(
      `${JSON.stringify(path)} isn't a project file: use .furrow, .furrow.zip or .furrow.json.`,
    );
  }
  return normalize(path).replace(PROJECT_PATH, PROJECT_DESKTOP_EXTENSION);
}

/**
 * The projects open in this server session, by the file each was opened
 * from, or, once saved, the `.furrow` file it saves to.
 */
export function createProjects() {
  const open = new Map<string, Project>();

  /** Makes `path` the only one `project` is found by. */
  function remember(path: string, project: Project) {
    for (const [key, value] of open) if (value === project) open.delete(key);
    open.set(path, project);
  }

  async function write(project: Project, path: string, exists: string) {
    let bytes: Uint8Array;
    const document = project.store.getState().document;
    try {
      bytes = writeProjectFile({ ...project, document });
    } catch (error) {
      if (error instanceof ProjectArchiveError) throw new ToolError(formatMessage(t, error.detail));
      throw error;
    }
    try {
      await writeFileAtomic(path, bytes, project.owned && path === project.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ToolError(`${path} already exists: ${exists}`);
      }
      throw new ToolError(`Can't write ${path}: ${(error as Error).message}`);
    }
  }

  async function openProject(path: string): Promise<Project> {
    const target = savePath(path);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (error) {
      throw new ToolError(`Can't read ${path}: ${(error as Error).message}`);
    }
    let file: Awaited<ReturnType<typeof readProjectFile>>;
    try {
      file = await readProjectFile(bytes, t);
    } catch (error) {
      throw new ToolError((error as Error).message);
    }
    const project: Project = {
      path: target,
      store: createDocumentStore(file.document),
      meshes: file.meshes,
      fonts: file.fonts,
      versions: file.versions,
      kept: false,
      owned: normalize(path) === target,
    };
    remember(normalize(path), project);
    return project;
  }

  return {
    /** Creates an empty project at `path`, a new `.furrow` file. */
    async create(path: string): Promise<Project> {
      const target = savePath(path);
      const project: Project = {
        path: target,
        store: createDocumentStore(createProjectDocument()),
        meshes: new Map(),
        fonts: new Map(),
        versions: [],
        kept: true,
        owned: false,
      };
      await write(project, target, "open it, or choose another path.");
      project.owned = true;
      remember(target, project);
      return project;
    },

    /** Opens the project at `path` from its file, dropping changes to it that weren't saved. */
    open: openProject,

    /** The open project at `path`, opened from its file if it isn't yet. */
    async get(path: string): Promise<Project> {
      return open.get(normalize(path)) ?? openProject(path);
    },

    /**
     * Saves `project` to its `.furrow` file, or to `to`'s, which it then
     * saves to. Never replaces another file. Returns the path written.
     */
    async save(project: Project, to?: string): Promise<string> {
      const target = to === undefined ? project.path : savePath(to);
      await write(project, target, "save the project to another path.");
      project.path = target;
      project.owned = true;
      remember(target, project);
      return target;
    },
  };
}

export type Projects = ReturnType<typeof createProjects>;

/**
 * Runs `edit` on `project`'s document store, which tools change only through
 * the workspace's actions (ADR-0067). The first change in a session keeps the
 * document as it was as an automatic version, so the user can restore it
 * (ADR-0028); a project with no room for one is refused before any change.
 */
export function change(project: Project, edit: (store: DocumentStore) => void) {
  if (!project.kept && project.versions.length >= MAX_VERSIONS) {
    throw new ToolError(t("Desktop.Session.tooManyVersions", { max: MAX_VERSIONS }));
  }
  const before = project.store.getState().document;
  edit(project.store);
  if (project.kept || project.store.getState().document === before) return;
  project.versions = [
    ...project.versions,
    {
      id: randomUUID(),
      label: KEPT_VERSION_LABEL,
      createdAt: new Date(),
      automatic: true,
      document: before,
    },
  ];
  project.kept = true;
}
