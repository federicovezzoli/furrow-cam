import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  circle,
  fullDocument,
  model,
  square,
  textItem,
  textShape,
  uploadedFont,
} from "../fixtures";
import { createProjectDocument, type ProjectDocument } from "../schema/document";
import {
  ARCHIVE_DOCUMENT_PATH,
  type ArchiveVersion,
  archiveFontPath,
  archiveMeshPath,
  archiveVersionPath,
  MAX_ARCHIVE_DOCUMENT_BYTES,
  MAX_ARCHIVE_MESHES,
  MAX_ARCHIVE_VERSIONS,
  maxArchiveBytes,
  missingArchiveFonts,
  missingArchiveMeshes,
  ProjectArchiveError,
  packProjectArchive,
  readProjectArchive,
  sha256Hex,
} from "./archive";
import { parseProjectDocument } from "./migrations";

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

function version(id: string, document: ProjectDocument, at = 0): ArchiveVersion {
  return {
    id,
    label: `v${id}`,
    createdAt: new Date(Date.UTC(2026, 9, 1) + at),
    automatic: false,
    document,
  };
}

/** A version file as `packProjectArchive` writes it, with `fields` changed. */
function versionFile(fields: Record<string, unknown>) {
  return strToU8(
    JSON.stringify({
      id: "a",
      label: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      automatic: false,
      document: createProjectDocument(),
      ...fields,
    }),
  );
}

async function readError(bytes: Uint8Array) {
  const error = await readProjectArchive(bytes, MAX_MESH_BYTES).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ProjectArchiveError);
  return (error as ProjectArchiveError).detail;
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

  it("store meshes uncompressed and deflate the document", async () => {
    const { document, meshes, sha256 } = await projectWithModel();
    const compression = new Map<string, number>();
    unzipSync(packProjectArchive(document, meshes), {
      filter: ({ name, compression: method }) => {
        compression.set(name, method);
        return false;
      },
    });
    expect(compression.get(archiveMeshPath(sha256))).toBe(0);
    expect(compression.get(ARCHIVE_DOCUMENT_PATH)).toBe(8);
  });

  it("read archives whose meshes are deflated", async () => {
    const { document, meshes, sha256 } = await projectWithModel();
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      [archiveMeshPath(sha256)]: meshes.get(sha256) as Uint8Array,
    });
    const archive = await readProjectArchive(zip, MAX_MESH_BYTES);
    expect(archive.meshes).toEqual(meshes);
  });

  it("round-trip several drawings and text items, in the document and its versions", async () => {
    const other = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
    const base = fullDocument();
    const document: ProjectDocument = {
      ...base,
      drawings: [...base.drawings, { id: other, name: "hole.svg", border: 5 }, textItem],
      geometry: [square, { ...circle, drawingId: other }, textShape],
    };
    const archive = await readProjectArchive(
      packProjectArchive(document, new Map(), [version("v", document)]),
      MAX_MESH_BYTES,
    );
    expect(parseProjectDocument(JSON.parse(archive.contents))).toEqual(document);
    expect(archive.versions[0]?.document).toEqual(document);
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

describe("archive fonts", () => {
  /** `fullDocument` with `font`, an uploaded font whose file is `text`. */
  async function withFont(text = "font bytes") {
    const bytes = strToU8(text);
    const sha256 = await sha256Hex(bytes);
    const font = { ...uploadedFont, sha256, size: bytes.byteLength };
    const document: ProjectDocument = { ...fullDocument(), fonts: [font] };
    return { document, fonts: new Map([[sha256, bytes]]), sha256 };
  }

  it("round-trip with the document and its versions", async () => {
    const { document, fonts, sha256 } = await withFont();
    const versions = [version("v", document)];
    const archive = await readProjectArchive(
      packProjectArchive(document, new Map(), versions, fonts),
      MAX_MESH_BYTES,
    );
    expect(parseProjectDocument(JSON.parse(archive.contents))).toEqual(document);
    expect(archive.fonts).toEqual(fonts);
    expect(archive.versions[0]?.document).toEqual(document);
    expect(missingArchiveFonts(document, archive.fonts)).toEqual([]);
    expect(missingArchiveFonts(document, new Map())).toEqual([sha256]);
  });

  it("refuse to pack a missing font", async () => {
    const { document } = await withFont();
    expect(() => packProjectArchive(document, new Map(), [], new Map())).toThrow("missing");
  });

  it("refuse a damaged font, a version missing its font and too many fonts", async () => {
    const { document, fonts, sha256 } = await withFont();
    const wrong = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      [archiveFontPath(sha256)]: strToU8("other bytes"),
    });
    expect(await readError(wrong)).toEqual({ code: "archive.fontDamaged" });
    const missing = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(createProjectDocument())),
      [archiveVersionPath("a")]: versionFile({ document }),
    });
    expect(await readError(missing)).toMatchObject({ code: "archive.versionMissingFont" });
    const many = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      ...Object.fromEntries(
        // One more than an archive holds.
        Array.from({ length: 17 }, (_, i) => [
          archiveFontPath(i.toString(16).padStart(64, "0")),
          fonts.get(sha256) as Uint8Array,
        ]),
      ),
    });
    expect(await readError(many)).toEqual({ code: "archive.tooManyFonts", values: { max: 16 } });
  });
});

describe("archive versions", () => {
  it("round-trip with the document, newest first, including meshes only a version uses", async () => {
    const { document: withModel, meshes, sha256 } = await projectWithModel();
    const document = createProjectDocument();
    const versions = [version("older", withModel, 0), version("newer", document, 1000)];
    const archive = await readProjectArchive(
      packProjectArchive(document, meshes, versions),
      MAX_MESH_BYTES,
    );
    expect(JSON.parse(archive.contents)).toEqual(document);
    expect(archive.versions).toEqual([versions[1], versions[0]]);
    expect([...archive.meshes.keys()]).toEqual([sha256]);
  });

  it("read archives without versions as before", async () => {
    const { document, meshes } = await projectWithModel();
    const archive = await readProjectArchive(packProjectArchive(document, meshes), MAX_MESH_BYTES);
    expect(archive.versions).toEqual([]);
  });

  it("upgrade a version's document to the current schema version", async () => {
    const current = createProjectDocument();
    // Before schema version 13, stock had no touch-off pad.
    const { touchOff: _, ...stock } = current.stock;
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(current)),
      [archiveVersionPath("a")]: versionFile({
        document: { ...current, schemaVersion: 12, stock },
      }),
    });
    const [read] = (await readProjectArchive(zip, MAX_MESH_BYTES)).versions;
    expect(read?.document).toEqual(current);
  });

  it("refuse a version that isn't a valid document", async () => {
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(createProjectDocument())),
      [archiveVersionPath("a")]: versionFile({ document: { schemaVersion: 1 } }),
    });
    expect(await readError(zip)).toEqual({
      code: "archive.versionInvalid",
      values: { labelled: "no", label: "" },
    });
  });

  it("refuse to pack a version whose mesh is missing, or whose id can't name a file", async () => {
    const { document: withModel } = await projectWithModel();
    const document = createProjectDocument();
    expect(() => packProjectArchive(document, new Map(), [version("a", withModel)])).toThrow(
      /missing/,
    );
    expect(() => packProjectArchive(document, new Map(), [version("../a", document)])).toThrow(
      /can't name a file/,
    );
  });

  it("refuse to pack more versions than an archive may hold", () => {
    const document = createProjectDocument();
    const versions = Array.from({ length: MAX_ARCHIVE_VERSIONS + 1 }, (_, i) =>
      version(String(i), document),
    );
    expect(() => packProjectArchive(document, new Map(), versions)).toThrow(ProjectArchiveError);
  });

  it("count the meshes of every version against the limit", async () => {
    const document = createProjectDocument();
    const meshes = new Map<string, Uint8Array>();
    const versions: ArchiveVersion[] = [];
    for (let i = 0; i <= MAX_ARCHIVE_MESHES; i++) {
      const { bytes, sha256 } = await mesh(`solid ${i}\n`);
      meshes.set(sha256, bytes);
      versions.push(version(String(i), { ...document, models: [{ ...model, sha256 }] }));
    }
    expect(() => packProjectArchive(document, meshes, versions)).toThrow(ProjectArchiveError);
  });

  it("refuse too many versions when reading", async () => {
    const files: Record<string, Uint8Array> = {
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(createProjectDocument())),
    };
    for (let i = 0; i <= MAX_ARCHIVE_VERSIONS; i++) {
      files[archiveVersionPath(String(i))] = versionFile({ id: String(i) });
    }
    expect(await readError(zipSync(files))).toEqual({
      code: "archive.tooManyVersions",
      values: { max: MAX_ARCHIVE_VERSIONS },
    });
  });

  it("refuse an oversized version before inflating it", async () => {
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(createProjectDocument())),
      [archiveVersionPath("a")]: new Uint8Array(MAX_ARCHIVE_DOCUMENT_BYTES + 1),
    });
    expect(await readError(zip)).toEqual({ code: "archive.documentTooLarge" });
  });

  it("refuse a damaged version, or one that lacks its mesh", async () => {
    const document = createProjectDocument();
    const damaged = async (file: Uint8Array) =>
      readError(
        zipSync({ [ARCHIVE_DOCUMENT_PATH]: strToU8("{}"), [archiveVersionPath("a")]: file }),
      );
    const versionDamaged = { code: "archive.versionDamaged" };
    expect(await damaged(strToU8("not json"))).toEqual(versionDamaged);
    expect(await damaged(versionFile({ id: "b" }))).toEqual(versionDamaged);
    expect(await damaged(versionFile({ createdAt: "yesterday" }))).toEqual(versionDamaged);
    expect(
      await damaged(
        versionFile({ label: "first cut", document: { ...document, models: [model] } }),
      ),
    ).toEqual({
      code: "archive.versionMissingModel",
      values: { labelled: "yes", label: "first cut" },
    });
    expect(await damaged(versionFile({ document: { ...document, schemaVersion: 999 } }))).toEqual({
      code: "archive.versionTooNew",
      values: { labelled: "no", label: "" },
    });
    expect(await damaged(versionFile({ document: { ...document, schemaVersion: 0 } }))).toEqual({
      code: "archive.versionInvalid",
      values: { labelled: "no", label: "" },
    });
  });
});

describe("readProjectArchive", () => {
  it("refuses files that aren't zips, or zips without a document", async () => {
    expect(await readError(strToU8("{}"))).toEqual({ code: "archive.notAProject" });
    expect(await readError(zipSync({ "notes.txt": strToU8("hi") }))).toEqual({
      code: "archive.notAProject",
    });
  });

  it("refuses a mesh that doesn't match its hash", async () => {
    const { document, sha256 } = await projectWithModel();
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      [archiveMeshPath(sha256)]: strToU8("solid tampered\nendsolid tampered\n"),
    });
    expect(await readError(zip)).toEqual({ code: "archive.modelDamaged" });
  });

  it("refuses an oversized mesh before inflating it", async () => {
    const { document, sha256 } = await projectWithModel();
    const zip = zipSync({
      [ARCHIVE_DOCUMENT_PATH]: strToU8(JSON.stringify(document)),
      // Compresses to a few bytes.
      [archiveMeshPath(sha256)]: new Uint8Array(MAX_MESH_BYTES + 1),
    });
    expect(zip.byteLength).toBeLessThan(MAX_MESH_BYTES);
    expect(await readError(zip)).toMatchObject({ code: "archive.meshTooLarge" });
  });

  it("refuses an oversized file", async () => {
    expect(await readError(new Uint8Array(maxArchiveBytes(MAX_MESH_BYTES) + 1))).toMatchObject({
      code: "archive.fileTooLarge",
    });
  });

  it("refuses too many meshes", async () => {
    const files: Record<string, Uint8Array> = { [ARCHIVE_DOCUMENT_PATH]: strToU8("{}") };
    for (let i = 0; i <= MAX_ARCHIVE_MESHES; i++) {
      const { bytes, sha256 } = await mesh(`solid ${i}\n`);
      files[archiveMeshPath(sha256)] = bytes;
    }
    expect(await readError(zipSync(files))).toMatchObject({ code: "archive.tooManyMeshes" });
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
