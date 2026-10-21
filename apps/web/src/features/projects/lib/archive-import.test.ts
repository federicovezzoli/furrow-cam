import {
  createProjectDocument,
  type ProjectArchive,
  packProjectArchive,
  sha256Hex,
} from "@furrow/document";
import { lowRider, model } from "@furrow/document/fixtures";
import { MeshImportError } from "@furrow/workspace/lib/model-import";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const UPDATED_AT = new Date("2026-10-16T12:00:00Z");
const LIMITS = { maxBytes: 50_000_000, maxTriangles: 2_000_000 };
const document = { ...createProjectDocument(), machine: lowRider, models: [model] };

const actions = vi.hoisted(() => ({
  startArchiveImport: vi.fn(),
  saveProject: vi.fn(),
  deleteProject: vi.fn(),
}));
const uploadMesh = vi.hoisted(() => vi.fn());
const parseMesh = vi.hoisted(() => vi.fn());

vi.mock("@/features/projects/actions", () => actions);
vi.mock("@/features/assets/lib/meshes", () => ({ uploadMesh }));
vi.mock("@/features/assets/lib/mesh-cache", () => ({ cacheMesh: async () => {} }));
vi.mock("@furrow/workspace/lib/model-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@furrow/workspace/lib/model-import")>()),
  parseMesh,
}));

const { importArchive, readArchive } = await import("./archive-import");

const bytes = new Uint8Array(model.size);
const archive: ProjectArchive = {
  contents: JSON.stringify(document),
  meshes: new Map([[model.sha256, bytes]]),
  versions: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  parseMesh.mockResolvedValue({ sha256: model.sha256, triangles: 12, bounds: model.bounds });
  actions.startArchiveImport.mockResolvedValue({
    projectId: PROJECT,
    document,
    updatedAt: UPDATED_AT,
  });
  actions.saveProject.mockResolvedValue({ updatedAt: new Date() });
  actions.deleteProject.mockResolvedValue(undefined);
  uploadMesh.mockResolvedValue({ uploaded: true });
});

describe("importArchive", () => {
  it("uploads the meshes, then saves the imported document", async () => {
    expect(await importArchive(archive, "Relief.furrow.zip", null, LIMITS)).toEqual({
      projectId: PROJECT,
    });
    const [file] = actions.startArchiveImport.mock.calls[0] as [File];
    expect(await file.text()).toBe(archive.contents);
    expect(actions.startArchiveImport).toHaveBeenCalledWith(
      expect.any(File),
      "Relief.furrow.zip",
      [{ sha256: model.sha256, size: model.size }],
      null,
      undefined,
    );
    expect(uploadMesh).toHaveBeenCalledWith(PROJECT, model.sha256, expect.any(Blob));
    expect(actions.saveProject).toHaveBeenCalledWith(PROJECT, document, UPDATED_AT);
    expect(uploadMesh.mock.invocationCallOrder[0]).toBeLessThan(
      actions.saveProject.mock.invocationCallOrder[0] as number,
    );
    expect(actions.deleteProject).not.toHaveBeenCalled();
  });

  it("creates nothing when a mesh fails the STL import checks", async () => {
    parseMesh.mockRejectedValue(new MeshImportError({ code: "stl.noTriangles" }));
    // Tests run without a document, so messages are in English.
    expect(await importArchive(archive, "a.zip", null, LIMITS)).toEqual({
      error: "A model in this file can't be imported: This file has no triangles.",
    });
    expect(actions.startArchiveImport).not.toHaveBeenCalled();
  });

  it("checks and sends only the meshes the document uses, not those of its versions", async () => {
    const versionOnly = "f".repeat(64);
    // A version's model this server would refuse, e.g. with too many triangles.
    parseMesh.mockImplementation(async (bytes: ArrayBuffer) => {
      if (bytes.byteLength === 7) throw new Error("This file has too many triangles.");
      return { sha256: model.sha256, triangles: 12, bounds: model.bounds };
    });
    const withVersion: ProjectArchive = {
      ...archive,
      meshes: new Map([...archive.meshes, [versionOnly, new Uint8Array(7)]]),
    };
    expect(await importArchive(withVersion, "Relief.furrow", null, LIMITS)).toEqual({
      projectId: PROJECT,
    });
    expect(parseMesh).toHaveBeenCalledTimes(1);
    expect(actions.startArchiveImport).toHaveBeenCalledWith(
      expect.any(File),
      "Relief.furrow",
      [{ sha256: model.sha256, size: model.size }],
      null,
      undefined,
    );
  });

  it("refuses a mesh the document uses that is larger than this server allows", async () => {
    const small = { ...LIMITS, maxBytes: 1_000_000 };
    const large = { ...archive, meshes: new Map([[model.sha256, new Uint8Array(1_000_001)]]) };
    expect(await importArchive(large, "a.zip", null, small)).toEqual({
      error: "A model in this file is larger than 1 MB, the most allowed.",
    });
    expect(parseMesh).not.toHaveBeenCalled();
    expect(actions.startArchiveImport).not.toHaveBeenCalled();
  });

  it("passes on the server's refusal", async () => {
    actions.startArchiveImport.mockResolvedValue({ error: "Nope." });
    expect(await importArchive(archive, "a.zip", null, LIMITS)).toEqual({ error: "Nope." });
    expect(actions.deleteProject).not.toHaveBeenCalled();
  });

  it("deletes the project when an upload fails", async () => {
    uploadMesh.mockResolvedValue({ error: "The model couldn't be uploaded." });
    expect(await importArchive(archive, "a.zip", null, LIMITS)).toEqual({
      error: "The model couldn't be uploaded.",
    });
    expect(actions.saveProject).not.toHaveBeenCalled();
    expect(actions.deleteProject).toHaveBeenCalledWith(PROJECT);
  });

  it("deletes the project when saving the document fails", async () => {
    actions.saveProject.mockResolvedValue({ error: "The project couldn't be saved." });
    expect(await importArchive(archive, "a.zip", null, LIMITS)).toEqual({
      error: "The project couldn't be saved.",
    });
    expect(actions.deleteProject).toHaveBeenCalledWith(PROJECT);
  });

  it("deletes the project when the connection drops", async () => {
    actions.saveProject.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await importArchive(archive, "a.zip", null, LIMITS)).toHaveProperty("error");
    expect(actions.deleteProject).toHaveBeenCalledWith(PROJECT);
  });
});

describe("readArchive", () => {
  it("reads a file whose version uses a mesh larger than this server allows", async () => {
    const small = new Uint8Array(10);
    const large = new Uint8Array(1_000_001);
    const [smallSha, largeSha] = await Promise.all([sha256Hex(small), sha256Hex(large)]);
    const current = { ...document, models: [{ ...model, sha256: smallSha, size: 10 }] };
    const old = { ...document, models: [{ ...model, sha256: largeSha, size: large.byteLength }] };
    const bytes = packProjectArchive(
      current,
      new Map([
        [smallSha, small],
        [largeSha, large],
      ]),
      [{ id: "v1", label: null, createdAt: UPDATED_AT, automatic: false, document: old }],
    );
    const read = await readArchive(new File([bytes as Uint8Array<ArrayBuffer>], "Relief.furrow"), {
      ...LIMITS,
      maxBytes: 1_000_000,
    });
    expect([...read.meshes.keys()].sort()).toEqual([smallSha, largeSha].sort());
    parseMesh.mockResolvedValue({ sha256: smallSha, triangles: 12, bounds: model.bounds });
    actions.startArchiveImport.mockResolvedValue({
      projectId: PROJECT,
      document: current,
      updatedAt: UPDATED_AT,
    });
    expect(
      await importArchive(read, "Relief.furrow", null, { ...LIMITS, maxBytes: 1_000_000 }),
    ).toEqual({
      projectId: PROJECT,
    });
    expect(uploadMesh).toHaveBeenCalledTimes(1);
    expect(uploadMesh).toHaveBeenCalledWith(PROJECT, smallSha, expect.any(Blob));
  });
});
