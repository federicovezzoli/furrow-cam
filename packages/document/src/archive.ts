import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ProjectDocument } from "./document";

/**
 * Extension of exported projects with 3D models: a zip of the document and
 * the meshes it references, which a `.furrow.json` file can't carry (ADR-0029).
 */
export const PROJECT_ARCHIVE_EXTENSION = ".furrow.zip";

/** Where the document is in an archive. */
export const ARCHIVE_DOCUMENT_PATH = "project.furrow.json";

/** The most meshes an archive may hold. */
export const MAX_ARCHIVE_MESHES = 4;

/** Largest document an archive may hold, in bytes: what the server accepts for one (4 MB). */
export const MAX_ARCHIVE_DOCUMENT_BYTES = 4_000_000;

const MESH_PATH = /^meshes\/([0-9a-f]{64})\.stl$/;

/** Where the mesh hashing to `sha256` is in an archive. */
export function archiveMeshPath(sha256: string) {
  return `meshes/${sha256}.stl`;
}

/** Largest archive file accepted, in bytes, when each mesh may be `maxMeshBytes`. */
export function maxArchiveBytes(maxMeshBytes: number) {
  return MAX_ARCHIVE_DOCUMENT_BYTES + MAX_ARCHIVE_MESHES * maxMeshBytes;
}

/** Why an archive can't be imported, for the user. */
export class ProjectArchiveError extends Error {
  override name = "ProjectArchiveError";
}

const NOT_A_PROJECT = "This file isn't a Furrow CAM project.";

/**
 * Packs `document` with the mesh files its models reference, from `meshes`
 * by hash. Throws if one is missing.
 */
export function packProjectArchive(
  document: ProjectDocument,
  meshes: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [ARCHIVE_DOCUMENT_PATH]: strToU8(`${JSON.stringify(document, null, 2)}\n`),
  };
  for (const { sha256 } of document.models) {
    const mesh = meshes.get(sha256);
    if (!mesh) throw new Error(`The mesh ${sha256} is missing`);
    files[archiveMeshPath(sha256)] = mesh;
  }
  return zipSync(files);
}

/** What an archive holds: the document's text, still to be parsed, and the meshes by hash. */
export type ProjectArchive = { contents: string; meshes: Map<string, Uint8Array> };

/**
 * Reads an archive made by `packProjectArchive`. Each mesh may hold at most
 * `maxMeshBytes`, and must hash to the name it is stored under. Other files
 * (such as those a zip tool adds) are ignored. Throws a `ProjectArchiveError`
 * if the archive can't be imported; the document is checked by whoever
 * parses `contents`, and against `meshes` with `missingArchiveMeshes`.
 */
export async function readProjectArchive(
  bytes: Uint8Array,
  maxMeshBytes: number,
): Promise<ProjectArchive> {
  if (bytes.byteLength > maxArchiveBytes(maxMeshBytes)) throw tooLarge(maxMeshBytes);
  let entries: Record<string, Uint8Array>;
  let meshCount = 0;
  try {
    entries = unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        // Checked before inflating, so a small archive can't expand into a huge one.
        if (name === ARCHIVE_DOCUMENT_PATH) {
          if (originalSize > MAX_ARCHIVE_DOCUMENT_BYTES) {
            throw new ProjectArchiveError("This project's document is too large to import.");
          }
          return true;
        }
        if (!MESH_PATH.test(name)) return false;
        if (++meshCount > MAX_ARCHIVE_MESHES) {
          throw new ProjectArchiveError(
            `This file holds more than ${MAX_ARCHIVE_MESHES} models, the most allowed.`,
          );
        }
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
  return { contents: strFromU8(document), meshes };
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
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto is global in browsers, workers and Node; this package has no DOM types.
  const { subtle } = (
    globalThis as unknown as {
      crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
    }
  ).crypto;
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
