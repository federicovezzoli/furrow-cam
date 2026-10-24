import type { ArchiveVersion, ProjectDocument } from "@furrow/document";
import { MAX_VERSIONS, VERSION_LABEL_MAX } from "@furrow/workspace/lib/versions";
import type { AssetStore, VersionRow, WorkspaceHost } from "@furrow/workspace/lib/workspace-host";
import { t } from "./i18n";
import { type ProjectFile, writeProjectFile } from "./project-file";

const tooManyVersions = () => t("Desktop.Session.tooManyVersions", { max: MAX_VERSIONS });
const versionNotFound = () => t("Desktop.Session.versionNotFound");

export type ProjectSession = ReturnType<typeof createProjectSession>;

/** What a save wrote, so changes made while it ran stay unsaved. */
export type SavedContents = { document: string; versions: readonly ArchiveVersion[] };

/**
 * One open project in the desktop app (ADR-0047): the document, meshes and
 * versions in memory, the file they came from (`path`, `null` until first
 * saved) and whether they differ from it. The workspace's autosave and the
 * versions pane change it through `host`; Save writes `toFile()` and calls
 * `markSaved`. While there are unsaved changes, each change is handed to
 * `writeRecovery`; `deleteRecovery` is called once there are none. Both run
 * one at a time, in order, so an older copy never lands after a newer one or
 * after the copy was deleted.
 */
export function createProjectSession({
  id = crypto.randomUUID(),
  path,
  name,
  file,
  modified: startModified = false,
  onChange,
  writeRecovery,
  deleteRecovery,
  openAsProject,
}: {
  /** Names the session's recovery copy. */
  id?: string;
  path: string | null;
  name: string;
  file: ProjectFile;
  /** The contents aren't what the file has, e.g. a recovered copy. */
  modified?: boolean;
  /** Called when `path`, `name` or `modified` change. */
  onChange?: () => void;
  /** May return a promise; the next recovery operation waits for it. */
  writeRecovery?: (bytes: Uint8Array) => unknown;
  deleteRecovery?: () => unknown;
  openAsProject?: (file: ProjectFile, name: string) => void;
}) {
  let currentPath = path;
  let currentName = name;
  let document = file.document;
  const meshes = new Map(file.meshes);
  const fonts = new Map(file.fonts);
  let versions = [...file.versions];
  /** The document as last saved to the file, as JSON; `null` when it was never saved as is. */
  let savedDocument: string | null = startModified ? null : JSON.stringify(document);
  /** Versions were created, renamed, deleted or restored since the last save. */
  let versionsChanged = false;
  let modified = startModified;
  let savedAt = new Date();
  /** Closed without saving: nothing more reaches the recovery copy. */
  let closed = false;
  /** Recovery writes and deletes, run one after another. */
  let recovery: Promise<unknown> = Promise.resolve();

  function queueRecovery(operation: (() => unknown) | undefined) {
    if (!operation) return recovery;
    recovery = recovery.then(operation).catch((error: unknown) => console.error(error));
    return recovery;
  }

  /** A save time after the last, even within the same millisecond. */
  function tick() {
    savedAt = new Date(Math.max(Date.now(), savedAt.getTime() + 1));
    return savedAt;
  }

  function toFile(): Uint8Array {
    return writeProjectFile({ document, meshes, fonts, versions });
  }

  /** Works out `modified` again after a change, and keeps the recovery copy up to date. */
  function changed() {
    if (closed) return;
    const now = versionsChanged || savedDocument !== JSON.stringify(document);
    if (now) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = toFile();
      } catch (error) {
        // Past the file's limits: Save will say so; the recovery copy waits for a valid project.
        console.error(error);
      }
      if (bytes && writeRecovery) queueRecovery(() => writeRecovery(bytes));
    } else if (modified) queueRecovery(deleteRecovery);
    if (now !== modified) {
      modified = now;
      onChange?.();
    }
  }

  function rows(): VersionRow[] {
    // Newest first; versions made in the same millisecond keep the order they were made in.
    return versions
      .map((version, index) => ({ version, index }))
      .sort(
        (a, b) =>
          b.version.createdAt.getTime() - a.version.createdAt.getTime() || b.index - a.index,
      )
      .map(({ version: { id, label, createdAt } }) => ({ id, label, createdAt }));
  }

  function addVersion(label: string | null, automatic: boolean, source: ProjectDocument) {
    const version: ArchiveVersion = {
      id: crypto.randomUUID(),
      label,
      createdAt: new Date(),
      automatic,
      document: source,
    };
    versions = [...versions, version];
    versionsChanged = true;
  }

  function parseLabel(label: string): { label: string | null } | { error: string } {
    const trimmed = label.trim();
    if (trimmed.length > VERSION_LABEL_MAX) {
      return { error: t("Desktop.Session.labelTooLong", { max: VERSION_LABEL_MAX }) };
    }
    return { label: trimmed === "" ? null : trimmed };
  }

  const host: Pick<WorkspaceHost, "meshes" | "fonts" | "versions"> & {
    save: WorkspaceHost["project"]["save"];
  } = {
    save: async (next) => {
      document = next;
      changed();
      return { updatedAt: tick() };
    },
    meshes: fileAssets(meshes, () => t("Desktop.Session.missingModel")),
    fonts: fileAssets(fonts, () => t("Desktop.Session.missingFont")),
    versions: {
      list: async () => ({ versions: rows() }),
      create: async (label) => {
        const parsed = parseLabel(label);
        if ("error" in parsed) return parsed;
        if (versions.length >= MAX_VERSIONS) return { error: tooManyVersions() };
        addVersion(parsed.label, false, document);
        changed();
        return { versions: rows() };
      },
      rename: async (id, label) => {
        const parsed = parseLabel(label);
        if ("error" in parsed) return parsed;
        if (!versions.some((v) => v.id === id)) return { error: versionNotFound() };
        versions = versions.map((v) => (v.id === id ? { ...v, label: parsed.label } : v));
        versionsChanged = true;
        changed();
        return undefined;
      },
      delete: async (id) => {
        if (!versions.some((v) => v.id === id)) return { error: versionNotFound() };
        versions = versions.filter((v) => v.id !== id);
        versionsChanged = true;
        changed();
        return undefined;
      },
      restore: async (id) => {
        const version = versions.find((v) => v.id === id);
        if (!version) return { error: versionNotFound() };
        if (versions.length >= MAX_VERSIONS) return { error: tooManyVersions() };
        // Kept first, so a restore can be undone (ADR-0028).
        const keptLabel =
          version.label === null
            ? t("Desktop.Session.beforeRestoringEarlier")
            : t("Desktop.Session.beforeRestoring", { label: version.label });
        addVersion(keptLabel.slice(0, VERSION_LABEL_MAX), true, document);
        document = version.document;
        changed();
        return { document, updatedAt: tick(), versions: rows() };
      },
      openAsProject: async (id, dateLabel) => {
        const version = versions.find((v) => v.id === id);
        if (!version) return { error: versionNotFound() };
        if (!openAsProject) return { error: t("Desktop.Session.cantOpenVersions") };
        openAsProject(
          {
            document: version.document,
            meshes: new Map(meshes),
            fonts: new Map(fonts),
            versions: [],
          },
          `${currentName} (${version.label ?? dateLabel})`,
        );
        return undefined;
      },
    },
  };

  return {
    id,
    host,
    get path() {
      return currentPath;
    },
    get name() {
      return currentName;
    },
    get modified() {
      return modified;
    },
    /** The document as the workspace last saved it. */
    get document() {
      return document;
    },
    get savedAt() {
      return savedAt;
    },
    toFile,
    /** The file to write for Save, and what it holds, for `markSaved` once written. */
    prepareSave(): { bytes: Uint8Array; contents: SavedContents } {
      return { bytes: toFile(), contents: { document: JSON.stringify(document), versions } };
    },
    /**
     * The project was written to `path` with `contents`. Changes made since
     * `prepareSave` stay unsaved, with their recovery copy.
     */
    markSaved(path: string, name: string, contents: SavedContents) {
      currentPath = path;
      currentName = name;
      savedDocument = contents.document;
      // Version changes always replace the list, so the same list means none since.
      versionsChanged = versions !== contents.versions;
      // Taken as modified, so `changed` deletes the recovery copy if nothing is left unsaved.
      modified = true;
      changed();
      onChange?.();
    },
    /** The project is closed without saving: its recovery copy goes. Resolves once it has. */
    discard(): Promise<unknown> {
      closed = true;
      return queueRecovery(deleteRecovery);
    },
  };
}

/** An asset store over the file's `files` by hash; `missing` says why `get` fails. */
function fileAssets(files: Map<string, Uint8Array>, missing: () => string): AssetStore {
  return {
    put: async (sha256, blob) => {
      if (files.has(sha256)) return { uploaded: false };
      files.set(sha256, new Uint8Array(await blob.arrayBuffer()));
      return { uploaded: true };
    },
    get: async (sha256) => {
      const bytes = files.get(sha256);
      if (!bytes) throw new Error(missing());
      // A copy: workers take the buffers they're sent.
      return bytes.slice().buffer;
    },
    discard: async (sha256) => {
      files.delete(sha256);
    },
  };
}
