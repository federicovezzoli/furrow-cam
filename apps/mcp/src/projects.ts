import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import {
  type ArchiveVersion,
  createProjectDocument,
  PROJECT_PATH,
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
  /** The path it is found by: the file it was opened from, or the one it was last saved to. */
  source: string;
  /** The `.furrow` file it saves to. */
  path: string;
  store: DocumentStore;
  meshes: Map<string, Uint8Array>;
  fonts: Map<string, Uint8Array>;
  versions: ArchiveVersion[];
  /** Whether nothing is left to keep before a change: the version was kept, or the project is new. */
  kept: boolean;
  /** The id of the version kept before the first change, or `null` if none was. */
  keptId: string | null;
  /** Whether `path` is the project's own file, which saving may replace. */
  owned: boolean;
  /** Its own file's stamp (`stampOf`) when last read or written, to tell whether it changed since. */
  stamp: string | null;
  /** Whether it has changes its file hasn't. */
  unsaved: boolean;
  /** Whether saving them failed and was reported; tried and reported again after the next change. */
  reported: boolean;
};

/** The `.furrow` file a project at `path` saves to; throws a `ToolError` for other paths. */
export function savePath(path: string): string {
  if (!isAbsolute(path)) throw new ToolError(`Give an absolute path, not ${JSON.stringify(path)}.`);
  if (!PROJECT_PATH.test(path)) {
    throw new ToolError(
      `${JSON.stringify(path)} isn't a project file: use .furrow, .furrow.zip or .furrow.json.`,
    );
  }
  const normal = normalize(path);
  // Keeps the extension's case, so `Part.FURROW` saves to itself.
  return /\.furrow$/i.test(normal) ? normal : normal.replace(/\.(json|zip)$/i, "");
}

/**
 * `path`'s inode, change and modification times and size, or `null` if it
 * doesn't exist. A save by renaming a new file over it, as the desktop app
 * and this server save, gives it a new inode, so even a same-size save
 * within a filesystem's time resolution is seen. The desktop app's
 * `fileStamp` (apps/desktop/src/main/files.ts) is the same: keep them alike.
 */
function stampOf(path: string): Promise<string | null> {
  return stat(path).then(
    ({ ino, ctimeMs, mtimeMs, size }) => `${ino}:${ctimeMs}:${mtimeMs}:${size}`,
    () => null,
  );
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
    project.source = path;
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
    const replace = project.owned && path === project.path;
    if (replace && (await stampOf(path)) !== project.stamp) {
      throw new ToolError(
        `${path} changed since it was opened, maybe in the app: open it again, dropping these changes, or save the project to another path.`,
      );
    }
    try {
      await writeFileAtomic(path, bytes, replace);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ToolError(`${path} already exists: ${exists}`);
      }
      throw new ToolError(`Can't write ${path}: ${(error as Error).message}`);
    }
    project.stamp = await stampOf(path);
  }

  async function openProject(path: string): Promise<Project> {
    const target = savePath(path);
    const owned = normalize(path) === target;
    // Taken first: a change made while reading shows as one at the next save.
    const stamp = owned ? await stampOf(path) : null;
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
      source: path,
      path: target,
      store: createDocumentStore(file.document),
      meshes: file.meshes,
      fonts: file.fonts,
      versions: file.versions,
      kept: false,
      keptId: null,
      owned,
      stamp,
      unsaved: false,
      reported: false,
    };
    remember(normalize(path), project);
    return project;
  }

  return {
    /** Creates an empty project at `path`, a new `.furrow` file. */
    async create(path: string): Promise<Project> {
      const target = savePath(path);
      const project: Project = {
        source: target,
        path: target,
        store: createDocumentStore(createProjectDocument()),
        meshes: new Map(),
        fonts: new Map(),
        versions: [],
        kept: true,
        keptId: null,
        owned: false,
        stamp: null,
        unsaved: false,
        reported: false,
      };
      await write(project, target, "open it, or choose another path.");
      project.owned = true;
      remember(target, project);
      return project;
    },

    /** Opens the project at `path` from its file, dropping changes to it that weren't saved. */
    open: openProject,

    /**
     * The open project at `path`, opened from its file if it isn't yet, or
     * read again if its own file changed (the user saved it in the app) and
     * nothing here would be lost (#492).
     */
    async get(path: string): Promise<Project> {
      const project = open.get(normalize(path));
      if (!project) return openProject(path);
      if (project.owned && !project.unsaved) {
        const now = await stampOf(project.path);
        if (now !== null && now !== project.stamp) {
          const reread = await openProject(project.path);
          // Kept again only if the user's save dropped it, e.g. kept their own version over it.
          if (reread.versions.some((version) => version.id === project.keptId)) {
            reread.kept = true;
            reread.keptId = project.keptId;
          }
          return reread;
        }
      }
      return project;
    },

    /**
     * Saves `project` to its `.furrow` file, or to `to`'s, which it then
     * saves to. Never replaces another file, nor its own if it changed since
     * it was opened or saved. Returns the path written.
     */
    async save(project: Project, to?: string): Promise<string> {
      const target = to === undefined ? project.path : savePath(to);
      await write(project, target, "save the project to another path.");
      project.unsaved = false;
      project.path = target;
      project.owned = true;
      remember(target, project);
      return target;
    },

    /**
     * Saves each open project with changes to its own `.furrow` file, so the
     * desktop app shows them as they're made (#492). A project opened from a
     * `.furrow.zip` or `.furrow.json` waits for `save`. Returns why any
     * couldn't be saved, e.g. its file changed since; they stay unsaved here.
     */
    async saveChanges(): Promise<string[]> {
      const problems: string[] = [];
      for (const project of new Set(open.values())) {
        if (!project.owned || !project.unsaved || project.reported) continue;
        try {
          await this.save(project);
        } catch (error) {
          if (!(error instanceof ToolError)) throw error;
          problems.push(error.message);
          project.reported = true;
        }
      }
      return problems;
    },
  };
}

export type Projects = ReturnType<typeof createProjects>;

/**
 * Runs `edit` on `project`'s document store, which tools change only through
 * the workspace's actions (ADR-0067). The first change in a session keeps the
 * document as it was as an automatic version, so the user can restore it
 * (ADR-0028); a change to a project with no room for one is undone and refused.
 * If `edit` throws, everything it changed is undone: a tool call changes all
 * it was asked to, or nothing. That runs `edit` in a store transaction, so the
 * actions it calls must not open their own (`lib/text-items.ts` does): their
 * commit would end this one early, and a later refusal would undo nothing.
 */
export function change(project: Project, edit: (store: DocumentStore) => void) {
  const { document: before, past, future } = project.store.getState();
  const { beginTransaction, commitTransaction, cancelTransaction } = project.store.getState();
  beginTransaction();
  try {
    edit(project.store);
  } catch (error) {
    cancelTransaction();
    throw error;
  }
  commitTransaction();
  if (project.store.getState().document === before) return;
  if (project.kept) {
    project.unsaved = true;
    project.reported = false;
    return;
  }
  if (project.versions.length >= MAX_VERSIONS) {
    // Undone as a whole: an action may make several undo steps.
    project.store.setState({ document: before, past, future });
    throw new ToolError(t("Desktop.Session.tooManyVersions", { max: MAX_VERSIONS }));
  }
  const id = randomUUID();
  project.versions = [
    ...project.versions,
    {
      id,
      label: KEPT_VERSION_LABEL,
      createdAt: new Date(),
      automatic: true,
      document: before,
    },
  ];
  project.kept = true;
  project.keptId = id;
  project.unsaved = true;
  project.reported = false;
}
