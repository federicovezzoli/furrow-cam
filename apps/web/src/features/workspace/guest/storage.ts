import {
  ProjectDocument,
  ProjectDocumentTooNewError,
  ProjectDocumentVersionError,
  parseProjectDocument,
} from "@furrow/document";
import {
  parseSettings,
  parseTools,
  type Settings,
  saveTool,
} from "@furrow/workspace/lib/local-library";
import type {
  SavedTool,
  SaveResult,
  ToolChoice,
  ToolFormErrors,
} from "@furrow/workspace/lib/workspace-host";

/**
 * Guest projects, their STL files and settings, kept in the browser's
 * IndexedDB and never sent to the server (PRD-0008 G2, ADR-0050). Every
 * function rejects with an `Error` whose message is for the user, e.g. when
 * the browser blocks storage in a private window.
 */

import { formatMessage } from "@furrow/ui/lib/i18n";
import { clientTranslator } from "@/lib/client-translator";

const DB_NAME = "furrow-guest";
const DB_VERSION = 1;
const PROJECTS = "projects";
/** Keyed by `[projectId, sha256]`, so deleting a project deletes its files. */
const MESHES = "meshes";
/** Single records by name: `settings`, `tools` and `lastProjectId`. */
const SETTINGS = "settings";

/** A guest project without its document, for the project list. */
export type GuestProjectRow = { id: string; name: string; savedAt: Date };

/** A guest project as stored, its document upgraded to the current schema version. */
export type GuestProject = GuestProjectRow & { document: ProjectDocument };

/** A stored project's record: the document as saved, possibly by an older release. */
type ProjectRecord = { id: string; name: string; savedAt: Date; document: unknown };

type MeshRecord = { projectId: string; sha256: string; file: Blob };

const t = () => clientTranslator();
const storageUnavailable = () => t()("Guest.storageUnavailable");
const projectNotFound = () => t()("Guest.projectNotFound");
const conflict = () => t()("Guest.conflict");

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  const current = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new UserError(storageUnavailable()));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(PROJECTS, { keyPath: "id" });
      db.createObjectStore(MESHES, { keyPath: ["projectId", "sha256"] });
      db.createObjectStore(SETTINGS);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading to a newer release: let it, and reopen next time.
      db.onversionchange = () => {
        db.close();
        if (opening === current) opening = null;
      };
      // Closed by the browser, e.g. when site data is cleared: reopen next time.
      db.onclose = () => {
        if (opening === current) opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(new UserError(storageUnavailable()));
    request.onblocked = () => reject(new UserError(storageUnavailable()));
  });
  opening = current;
  // A failed open is retried next time rather than remembered.
  current.catch(() => {
    if (opening === current) opening = null;
  });
  return current;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs `work` in one transaction over `stores` and resolves with its result
 * once the transaction commits, so nothing is reported saved before it is.
 */
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await open();
  let tx: IDBTransaction;
  try {
    tx = db.transaction(stores, mode);
  } catch {
    throw new UserError(storageUnavailable());
  }
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
  // An aborted transaction rejects `done` while `work`'s own error is reported instead.
  done.catch(() => {});
  try {
    const value = await work(tx);
    await done;
    return value;
  } catch (error) {
    if (error instanceof UserError) throw error;
    // A failed read means storage is unavailable; a failed write may pass, e.g. once there is space.
    if (mode === "readonly") throw new UserError(storageUnavailable());
    throw new Error(t()("Guest.storageFailed"));
  }
}

/** A failure retrying can't clear, its message for the user; aborts the transaction it is thrown in. */
class UserError extends Error {}

function fail(tx: IDBTransaction, message: string): never {
  tx.abort();
  throw new UserError(message);
}

/** The record's document upgraded to the current schema version, or why it can't be. */
function parseDocument(json: unknown): ProjectDocument {
  try {
    return parseProjectDocument(json);
  } catch (error) {
    if (error instanceof ProjectDocumentTooNewError) {
      throw new UserError(t()("Guest.projectNewer"));
    }
    if (error instanceof ProjectDocumentVersionError) {
      throw new UserError(t()("Guest.cantOpen", { reason: formatMessage(t(), error.detail) }));
    }
    throw new UserError(t()("Guest.cantOpen", { reason: t()("Guest.contentsInvalid") }));
  }
}

/** The browser's guest projects, last saved first. */
export function listGuestProjects(): Promise<GuestProjectRow[]> {
  return transaction([PROJECTS], "readonly", async (tx) => {
    const records = await result<ProjectRecord[]>(tx.objectStore(PROJECTS).getAll());
    return records
      .map(({ id, name, savedAt }) => ({ id, name, savedAt }))
      .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
  });
}

/** Guest project `id`, or `null` if this browser doesn't have it. */
export function getGuestProject(id: string): Promise<GuestProject | null> {
  return transaction([PROJECTS], "readonly", async (tx) => {
    const record = await result<ProjectRecord | undefined>(tx.objectStore(PROJECTS).get(id));
    if (!record) return null;
    return {
      id,
      name: record.name,
      savedAt: record.savedAt,
      document: parseDocument(record.document),
    };
  });
}

/** Stores a new guest project called `name` holding `document`. */
export function createGuestProject(name: string, document: ProjectDocument): Promise<GuestProject> {
  const project = {
    id: crypto.randomUUID(),
    name,
    savedAt: new Date(),
    document: ProjectDocument.parse(document),
  };
  return transaction([PROJECTS], "readwrite", async (tx) => {
    await result(tx.objectStore(PROJECTS).add(project satisfies ProjectRecord));
    return project;
  });
}

/**
 * Saves `document` over guest project `id` as saved at `savedAt`; refused
 * when another tab saved it since, as the server refuses a stale save.
 */
export async function saveGuestProject(
  id: string,
  document: ProjectDocument,
  savedAt: Date,
): Promise<SaveResult> {
  const parsed = ProjectDocument.safeParse(document);
  if (!parsed.success) {
    return { error: t()("Guest.saveInvalid"), retryable: true };
  }
  try {
    return await transaction([PROJECTS], "readwrite", async (tx) => {
      const store = tx.objectStore(PROJECTS);
      const record = await result<ProjectRecord | undefined>(store.get(id));
      if (!record) fail(tx, projectNotFound());
      if (record.savedAt.getTime() !== savedAt.getTime()) fail(tx, conflict());
      // Never earlier than the last save, so the conflict check holds within a millisecond.
      const updatedAt = new Date(Math.max(Date.now(), record.savedAt.getTime() + 1));
      await result(store.put({ ...record, document: parsed.data, savedAt: updatedAt }));
      return { updatedAt };
    });
  } catch (error) {
    const { message } = error as Error;
    // Only a failed write, such as a full disk, may pass on the next try.
    return error instanceof UserError ? { error: message } : { error: message, retryable: true };
  }
}

export function renameGuestProject(id: string, name: string): Promise<void> {
  return transaction([PROJECTS], "readwrite", async (tx) => {
    const store = tx.objectStore(PROJECTS);
    const record = await result<ProjectRecord | undefined>(store.get(id));
    if (!record) fail(tx, projectNotFound());
    await result(store.put({ ...record, name }));
  });
}

/** Deletes guest project `id` and its STL files. */
export function deleteGuestProject(id: string): Promise<void> {
  return transaction([PROJECTS, MESHES], "readwrite", async (tx) => {
    await result(tx.objectStore(PROJECTS).delete(id));
    await result(tx.objectStore(MESHES).delete(projectMeshes(id)));
  });
}

/**
 * Deletes guest project `id` and its STL files only if it is still as saved
 * at `savedAt`, e.g. the copy just imported into an account; `false` when
 * another tab saved it since, which keeps it.
 */
export function deleteGuestProjectIfSaved(id: string, savedAt: Date): Promise<boolean> {
  return transaction([PROJECTS, MESHES], "readwrite", async (tx) => {
    const record = await result<ProjectRecord | undefined>(tx.objectStore(PROJECTS).get(id));
    if (!record) return true;
    if (record.savedAt.getTime() !== savedAt.getTime()) return false;
    await result(tx.objectStore(PROJECTS).delete(id));
    await result(tx.objectStore(MESHES).delete(projectMeshes(id)));
    return true;
  });
}

/** Every mesh key of project `id`: `[id, sha256]` for any `sha256`. */
function projectMeshes(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id], [id, []]);
}

/**
 * Stores `file` for project `projectId`; `uploaded` is `false` when it
 * already had it. Refused once the project is deleted, so no file outlives it.
 */
export function putGuestMesh(
  projectId: string,
  sha256: string,
  file: Blob,
): Promise<{ uploaded: boolean }> {
  return transaction([PROJECTS, MESHES], "readwrite", async (tx) => {
    if ((await result(tx.objectStore(PROJECTS).count(projectId))) === 0) {
      fail(tx, projectNotFound());
    }
    const store = tx.objectStore(MESHES);
    if ((await result(store.count([projectId, sha256]))) > 0) return { uploaded: false };
    await result(store.add({ projectId, sha256, file } satisfies MeshRecord));
    return { uploaded: true };
  });
}

/** The bytes of project `projectId`'s file `sha256`. */
export async function getGuestMesh(projectId: string, sha256: string): Promise<ArrayBuffer> {
  const record = await transaction([MESHES], "readonly", (tx) =>
    result<MeshRecord | undefined>(tx.objectStore(MESHES).get([projectId, sha256])),
  );
  if (!record) throw new Error(t()("Guest.meshMissing"));
  return record.file.arrayBuffer();
}

/** Drops project `projectId`'s file `sha256`; never fails. */
export async function deleteGuestMesh(projectId: string, sha256: string): Promise<void> {
  try {
    await transaction([MESHES], "readwrite", (tx) =>
      result(tx.objectStore(MESHES).delete([projectId, sha256])),
    );
  } catch {
    // Left behind, it is deleted with its project.
  }
}

/** The guest's settings: tours seen and panel sizes. */
export function readGuestSettings(): Promise<Settings> {
  return transaction([SETTINGS], "readonly", async (tx) =>
    parseSettings(await result(tx.objectStore(SETTINGS).get("settings"))),
  );
}

export function saveGuestSettings(settings: Settings): Promise<void> {
  return transaction([SETTINGS], "readwrite", async (tx) => {
    await result(tx.objectStore(SETTINGS).put(settings, "settings"));
  });
}

/**
 * The guest's own bits (PRD-0008 G4); the catalog's are offered beside them.
 * Empty at first: the catalog already has the default bit.
 */
export function readGuestTools(): Promise<ToolChoice[]> {
  return transaction([SETTINGS], "readonly", async (tx) =>
    parseTools((await result(tx.objectStore(SETTINGS).get("tools"))) ?? []),
  );
}

/**
 * Saves the tool form as the guest's bit `id`, or a new one when `null`, over
 * the bits as stored now, in one transaction, so a bit saved in another tab
 * meanwhile is kept. Returns the bits after the save.
 */
export function saveGuestTool(
  id: string | null,
  form: FormData,
): Promise<{ errors: ToolFormErrors } | { tools: ToolChoice[]; saved: SavedTool }> {
  return transaction([SETTINGS], "readwrite", async (tx) => {
    const store = tx.objectStore(SETTINGS);
    const saved = saveTool(parseTools((await result(store.get("tools"))) ?? []), id, form);
    if ("errors" in saved) return saved;
    await result(store.put(saved.tools, "tools"));
    return saved;
  });
}

/** The project the guest last opened, to open again on their next visit (PRD-0008 G1). */
export function readLastGuestProjectId(): Promise<string | null> {
  return transaction([SETTINGS], "readonly", async (tx) => {
    const id: unknown = await result(tx.objectStore(SETTINGS).get("lastProjectId"));
    return typeof id === "string" ? id : null;
  });
}

export function saveLastGuestProjectId(id: string): Promise<void> {
  return transaction([SETTINGS], "readwrite", async (tx) => {
    await result(tx.objectStore(SETTINGS).put(id, "lastProjectId"));
  });
}
