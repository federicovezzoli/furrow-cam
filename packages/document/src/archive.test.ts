import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_DOCUMENT_PATH,
  archiveMeshPath,
  MAX_ARCHIVE_MESHES,
  maxArchiveBytes,
  missingArchiveMeshes,
  ProjectArchiveError,
  packProjectArchive,
  readProjectArchive,
  sha256Hex,
} from "./archive";
import { createProjectDocument, type ProjectDocument } from "./document";
import { model } from "./fixtures";

const MAX_MESH_BYTES = 1_000;

/** A mesh file and its hash. */
async function mesh(text: string) {
  const bytes = strToU8(text);
  return { bytes, sha256: await sha256Hex(bytes) };
}

async function projectWithModel() {
  const { bytes, sha256 } = await mesh("solid emblem\nendsolid emblem\n");
  const document: ProjectDocument = {
    ...createProjectDocument(),
    models: [{ ...model, sha256, size: bytes.byteLength }],
  };
  return { document, meshes: new Map([[sha256, bytes]]), sha256 };
}

async function readError(bytes: Uint8Array) {
  const error = await readProjectArchive(bytes, MAX_MESH_BYTES).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ProjectArchiveError);
  return (error as Error).message;
}

describe("packProjectArchive and readProjectArchive", () => {
  it("round-trip the document and its meshes", async () => {
    const { document, meshes, sha256 } = await projectWithModel();
    const archive = await readProjectArchive(packProjectArchive(document, meshes), MAX_MESH_BYTES);
    expect(JSON.parse(archive.contents)).toEqual(document);
    expect(archive.meshes).toEqual(meshes);
    expect(missingArchiveMeshes(document, archive.meshes)).toEqual([]);
    expect(missingArchiveMeshes(document, new Map())).toEqual([sha256]);
  });

  it("only pack the meshes the document references", async () => {
    const { document, meshes } = await projectWithModel();
    const other = await mesh("solid other\nendsolid other\n");
    meshes.set(other.sha256, other.bytes);
    const archive = await readProjectArchive(packProjectArchive(document, meshes), MAX_MESH_BYTES);
    expect([...archive.meshes.keys()]).toEqual([document.models[0]?.sha256]);
  });

  it("refuse to pack a document whose mesh is missing", async () => {
    const { document } = await projectWithModel();
    expect(() => packProjectArchive(document, new Map())).toThrow(/missing/);
  });

  it("refuse to pack more meshes than an archive may hold, so every export imports", async () => {
    const { document, meshes } = await projectWithModel();
    const [first] = document.models;
    for (let i = 0; i < MAX_ARCHIVE_MESHES; i++) {
      const { bytes, sha256 } = await mesh(`solid ${i}\n`);
      meshes.set(sha256, bytes);
      document.models.push({ ...(first as (typeof document.models)[number]), sha256 });
    }
    expect(() => packProjectArchive(document, meshes)).toThrow(ProjectArchiveError);
  });
});

describe("readProjectArchive", () => {
  it("refuses files that aren't zips, or zips without a document", async () => {
    expect(await readError(strToU8("{}"))).toBe("This file isn't a Furrow CAM project.");
    expect(await readError(zipSync({ "notes.txt": strToU8("hi") }))).toBe(
      "This file isn't a Furrow CAM project.",
    );
  });

  it("refuses a mesh that doesn't match its hash", async () => {
    const { document, sha256 } = await projectWithModel();
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      [archiveMeshPath(sha256)]: strToU8("solid tampered\nendsolid tampered\n"),
    });
    expect(await readError(zip)).toMatch(/damaged/);
  });

  it("refuses an oversized mesh before inflating it", async () => {
    const { document, sha256 } = await projectWithModel();
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      // Compresses to a few bytes.
      [archiveMeshPath(sha256)]: new Uint8Array(MAX_MESH_BYTES + 1),
    });
    expect(zip.byteLength).toBeLessThan(MAX_MESH_BYTES);
    expect(await readError(zip)).toMatch(/larger than/);
  });

  it("refuses an oversized file", async () => {
    expect(await readError(new Uint8Array(maxArchiveBytes(MAX_MESH_BYTES) + 1))).toMatch(
      /too large to import/,
    );
  });

  it("refuses too many meshes", async () => {
    const files: Record<string, Uint8Array> = { [ARCHIVE_DOCUMENT_PATH]: strToU8("{}") };
    for (let i = 0; i <= MAX_ARCHIVE_MESHES; i++) {
      const { bytes, sha256 } = await mesh(`solid ${i}\n`);
      files[archiveMeshPath(sha256)] = bytes;
    }
    expect(await readError(zipSync(files))).toMatch(/at most/);
  });

  it("ignores files other than the document and meshes", async () => {
    const { document, meshes } = await projectWithModel();
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      "__MACOSX/._project.furrow.json": strToU8("resource fork"),
      ...Object.fromEntries([...meshes].map(([sha256, bytes]) => [archiveMeshPath(sha256), bytes])),
    });
    expect((await readProjectArchive(zip, MAX_MESH_BYTES)).meshes).toEqual(meshes);
  });
});
