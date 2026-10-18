import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import type { ProjectDocument } from "./document";
import { ProjectDocumentTooNewError, parseProjectDocument } from "./migrations";

/**
 * Extension of exported projects with 3D models: a zip of the document and
 * the meshes it references, which a `.furrow.json` file can't carry (ADR-0029).
 */
export const PROJECT_ARCHIVE_EXTENSION = ".furrow.zip";

/**
 * Extension of desktop app projects (ADR-0047): the `.furrow.zip` layout,
 * plus the project's saved versions.
 */
export const PROJECT_DESKTOP_EXTENSION = ".furrow";

/** Where the document is in an archive. */
export const ARCHIVE_DOCUMENT_PATH = "project.furrow.json";

/** The most meshes an archive may hold, counting those only its versions use. */
export const MAX_ARCHIVE_MESHES = 4;

/** The most versions an archive may hold, as a project keeps (ADR-0028). */
export const MAX_ARCHIVE_VERSIONS = 50;

/** Largest document an archive may hold, in bytes: what the server accepts for one (4 MB). */
export const MAX_ARCHIVE_DOCUMENT_BYTES = 4_000_000;

const MESH_PATH = /^meshes\/([0-9a-f]{64})\.stl$/;
const VERSION_PATH = /^versions\/([A-Za-z0-9_-]{1,64})\.json$/;

/** Where the mesh hashing to `sha256` is in an archive. */
export function archiveMeshPath(sha256: string) {
  return `meshes/${sha256}.stl`;
}

/** Where the version `id` is in an archive. */
export function archiveVersionPath(id: string) {
  return `versions/${id}.json`;
}

/**
 * Largest archive file accepted, in bytes, when each mesh may be
 * `maxMeshBytes`: the document and each version may take what one document may.
 */
export function maxArchiveBytes(maxMeshBytes: number) {
  return (
    (1 + MAX_ARCHIVE_VERSIONS) * MAX_ARCHIVE_DOCUMENT_BYTES + MAX_ARCHIVE_MESHES * maxMeshBytes
  );
}

/**
 * A saved version of the project (ADR-0028), as an archive carries it: a full
 * document, upgraded to the current schema version when read. `automatic`
 * versions were kept by the app, e.g. before a restore.
 */
export type ArchiveVersion = {
  id: string;
  label: string | null;
  createdAt: Date;
  automatic: boolean;
  document: ProjectDocument;
};

/** A version file's fields; its document is checked on its own. */
const VersionFile = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  label: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }).transform((date) => new Date(date)),
  automatic: z.boolean(),
  document: z.unknown(),
});

/** Why an archive can't be imported, for the user. */
export class ProjectArchiveError extends Error {
  override name = "ProjectArchiveError";
}

const NOT_A_PROJECT = "This file isn't a Furrow CAM project.";

/**
 * Packs `document` and its `versions` with the mesh files their models
 * reference, from `meshes` by hash. Throws if one is missing or a version's
 * id can't name a file, and a `ProjectArchiveError` if there are more
 * meshes or versions than `readProjectArchive` accepts, or a document is
 * larger than it accepts.
 */
export function packProjectArchive(
  document: ProjectDocument,
  meshes: ReadonlyMap<string, Uint8Array>,
  versions: readonly ArchiveVersion[] = [],
): Uint8Array {
  if (versions.length > MAX_ARCHIVE_VERSIONS) throw tooManyVersions();
  const files: Record<string, Uint8Array> = {
    [ARCHIVE_DOCUMENT_PATH]: documentFile(document),
  };
  for (const version of versions) {
    if (!VERSION_PATH.test(archiveVersionPath(version.id))) {
      throw new Error(`The version id ${JSON.stringify(version.id)} can't name a file`);
    }
    const { id, label, createdAt, automatic } = version;
    files[archiveVersionPath(id)] = documentFile({
      id,
      label,
      createdAt: createdAt.toISOString(),
      automatic,
      document: version.document,
    });
  }
  const sha256s = new Set(
    [document, ...versions.map((version) => version.document)].flatMap((doc) =>
      doc.models.map(({ sha256 }) => sha256),
    ),
  );
  if (sha256s.size > MAX_ARCHIVE_MESHES) throw tooManyMeshes();
  for (const sha256 of sha256s) {
    const mesh = meshes.get(sha256);
    if (!mesh) throw new Error(`The mesh ${sha256} is missing`);
    files[archiveMeshPath(sha256)] = mesh;
  }
  return zipSync(files);
}

/** `value` as an archive's JSON file; throws if it is larger than an archive accepts. */
function documentFile(value: unknown): Uint8Array {
  const bytes = strToU8(`${JSON.stringify(value, null, 2)}\n`);
  if (bytes.byteLength > MAX_ARCHIVE_DOCUMENT_BYTES) throw documentTooLarge();
  return bytes;
}

/**
 * What an archive holds: the document's text, still to be parsed, the meshes
 * by hash, and the versions, newest first.
 */
export type ProjectArchive = {
  contents: string;
  meshes: Map<string, Uint8Array>;
  versions: ArchiveVersion[];
};

/**
 * Reads an archive made by `packProjectArchive`. Each mesh may hold at most
 * `maxMeshBytes`, and must hash to the name it is stored under. Each version
 * is upgraded and validated, and must have the meshes its models reference.
 * Other files (such as those a zip tool adds) are ignored. Throws a
 * `ProjectArchiveError` if the archive can't be imported; the document is
 * checked by whoever parses `contents`, and against `meshes` with
 * `missingArchiveMeshes`.
 */
export async function readProjectArchive(
  bytes: Uint8Array,
  maxMeshBytes: number,
): Promise<ProjectArchive> {
  if (bytes.byteLength > maxArchiveBytes(maxMeshBytes)) throw tooLarge(maxMeshBytes);
  let entries: Record<string, Uint8Array>;
  let meshCount = 0;
  let versionCount = 0;
  try {
    entries = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        // Checked before inflating, so a small archive can't expand into a huge one.
        const isVersion = VERSION_PATH.test(name);
        if (name === ARCHIVE_DOCUMENT_PATH || isVersion) {
          if (originalSize > MAX_ARCHIVE_DOCUMENT_BYTES) throw documentTooLarge();
          if (isVersion && ++versionCount > MAX_ARCHIVE_VERSIONS) throw tooManyVersions();
          return true;
        }
        if (!MESH_PATH.test(name)) return false;
        if (++meshCount > MAX_ARCHIVE_MESHES) throw tooManyMeshes();
        if (originalSize > maxMeshBytes) throw meshTooLarge(maxMeshBytes);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error;
    throw new ProjectArchiveError(NOT_A_PROJECT);
  }

  const document = entries[ARCHIVE_DOCUMENT_PATH];
  if (!document) throw new ProjectArchiveError(NOT_A_PROJECT);
  const meshes = new Map<string, Uint8Array>();
  for (const [name, mesh] of Object.entries(entries)) {
    const sha256 = MESH_PATH.exec(name)?.[1];
    if (sha256 === undefined) continue;
    // The size in the header may not be the real one.
    if (mesh.byteLength > maxMeshBytes) throw meshTooLarge(maxMeshBytes);
    if ((await sha256Hex(mesh)) !== sha256) {
      throw new ProjectArchiveError("A model in this file is damaged: it doesn't match its hash.");
    }
    meshes.set(sha256, mesh);
  }
  const versions: ArchiveVersion[] = [];
  for (const [name, file] of Object.entries(entries)) {
    const id = VERSION_PATH.exec(name)?.[1];
    if (id === undefined) continue;
    // The size in the header may not be the real one.
    if (file.byteLength > MAX_ARCHIVE_DOCUMENT_BYTES) throw documentTooLarge();
    versions.push(readVersion(id, file, meshes));
  }
  versions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { contents: strFromU8(document), meshes, versions };
}

/** The version `id` from its file, checked as a document is; throws a `ProjectArchiveError`. */
function readVersion(
  id: string,
  file: Uint8Array,
  meshes: ReadonlyMap<string, unknown>,
): ArchiveVersion {
  let fields: z.infer<typeof VersionFile>;
  try {
    fields = VersionFile.parse(JSON.parse(strFromU8(file)));
  } catch {
    throw new ProjectArchiveError("A version in this file is damaged.");
  }
  if (fields.id !== id) throw new ProjectArchiveError("A version in this file is damaged.");
  const name = fields.label === null ? "A version in this file" : `The version “${fields.label}”`;
  let document: ProjectDocument;
  try {
    document = parseProjectDocument(fields.document);
  } catch (error) {
    throw new ProjectArchiveError(
      error instanceof ProjectDocumentTooNewError
        ? `${name} was saved by a newer version of Furrow CAM.`
        : `${name} isn't a valid project.`,
    );
  }
  if (missingArchiveMeshes(document, meshes).length > 0) {
    throw new ProjectArchiveError(`${name} is missing one of its 3D models.`);
  }
  return { ...fields, document };
}

/** The hashes of `document`'s models that `meshes` has no file for, each once. */
export function missingArchiveMeshes(
  document: ProjectDocument,
  meshes: ReadonlyMap<string, unknown>,
): string[] {
  return [...new Set(document.models.map(({ sha256 }) => sha256))].filter(
    (sha256) => !meshes.has(sha256),
  );
}

function tooManyMeshes() {
  return new ProjectArchiveError(
    `A project file holds at most ${MAX_ARCHIVE_MESHES} different 3D models.`,
  );
}

function tooManyVersions() {
  return new ProjectArchiveError(`A project file holds at most ${MAX_ARCHIVE_VERSIONS} versions.`);
}

function documentTooLarge() {
  return new ProjectArchiveError("This project's document is too large to import.");
}

function tooLarge(maxMeshBytes: number) {
  const mb = Math.round(maxArchiveBytes(maxMeshBytes) / 1_000_000);
  return new ProjectArchiveError(`This file is too large to import (the limit is ${mb} MB).`);
}

function meshTooLarge(maxMeshBytes: number) {
  return new ProjectArchiveError(
    `A model in this file is larger than ${maxMeshBytes / 1_000_000} MB, the most allowed.`,
  );
}

/** The SHA-256 of `bytes` in lowercase hex, as models identify their meshes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto is global in browsers, workers and Node; this package has no DOM types.
  const { subtle } = (
    globalThis as unknown as {
      crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
    }
  ).crypto;
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
