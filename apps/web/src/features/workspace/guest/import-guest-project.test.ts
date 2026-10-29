import { MeshImportError } from "@furrow/workspace/lib/model-import";
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import {
  CURRENT_SCHEMA_VERSION,
  createProjectDocument,
  packProjectArchive,
  sha256Hex,
} from "@furrow/document";
import { model, uploadedFont } from "@furrow/document/fixtures";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The archive reader's module also holds the account import, which calls server actions.
vi.mock("@/features/projects/actions", () => ({}));
vi.mock("@/features/assets/lib/asset-cache", () => ({}));
vi.mock("@/features/assets/lib/assets", () => ({}));
// Parsing runs in a Web Worker in the browser.
const parseMesh = vi.hoisted(() => vi.fn());
vi.mock("@furrow/workspace/lib/model-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@furrow/workspace/lib/model-import")>()),
  parseMesh,
}));

let storage: typeof import("./storage");
let guest: typeof import("./import-guest-project");

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  vi.resetModules();
  storage = await import("./storage");
  guest = await import("./import-guest-project");
});

function jsonFile(contents: unknown, name = "Coasters.furrow.json") {
  return new File([JSON.stringify(contents)], name, { type: "application/json" });
}

describe("importGuestProject", () => {
  it("creates a guest project named after a .furrow.json file", async () => {
    const document = { ...createProjectDocument(), units: "in" as const };
    const project = await guest.importGuestProject(jsonFile(document));
    expect(project.name).toBe("Coasters");
    expect((await storage.getGuestProject(project.id))?.document).toEqual(document);
  });

  it("refuses a file that isn't a project, leaving nothing behind", async () => {
    await expect(guest.importGuestProject(jsonFile({ name: "x" }))).rejects.toThrow(
      "isn't a Furrow CAM project",
    );
    await expect(guest.importGuestProject(new File(["not json"], "a.furrow.json"))).rejects.toThrow(
      "isn't a Furrow CAM project",
    );
    expect(await storage.listGuestProjects()).toEqual([]);
  });

  it("explains a file saved by a newer release", async () => {
    const newer = { ...createProjectDocument(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    await expect(guest.importGuestProject(jsonFile(newer))).rejects.toThrow("newer release");
  });

  it("refuses a .furrow.json file with models, whose meshes it lacks", async () => {
    const document = { ...createProjectDocument(), models: [model] };
    await expect(guest.importGuestProject(jsonFile(document))).rejects.toThrow(".zip export");
    expect(await storage.listGuestProjects()).toEqual([]);
  });
});

describe("guestProjectName", () => {
  it("names a project after its file, or a default", () => {
    expect(guest.guestProjectName("Coasters.furrow.zip")).toBe("Coasters");
    expect(guest.guestProjectName(".furrow.json")).toBe("Imported project");
    expect(guest.guestProjectName(`${"a".repeat(150)}.furrow.json`)).toHaveLength(100);
  });
});

describe("importGuestProject with uploaded fonts", () => {
  it("stores the fonts the project lists, once they parse, and refuses them in a .furrow.json", async () => {
    const font = new Uint8Array(
      readFileSync(
        new URL("../../../../../../packages/workspace/src/fonts/Arvo-Regular.ttf", import.meta.url),
      ),
    );
    const sha256 = await sha256Hex(font);
    const document = {
      ...createProjectDocument(),
      fonts: [{ ...uploadedFont, sha256, size: font.byteLength }],
    };
    const zip = packProjectArchive(document, new Map(), [], new Map([[sha256, font]]));
    const project = await guest.importGuestProject(
      new File([zip.slice()], "Sign.furrow.zip", { type: "application/zip" }),
    );
    expect(new Uint8Array(await storage.getGuestAsset(project.id, sha256, "font"))).toEqual(font);
    await expect(guest.importGuestProject(jsonFile(document))).rejects.toThrow("uploaded fonts");
    const wrongSize = { ...document, fonts: [{ ...document.fonts[0], size: 3 }] };
    const wrong = packProjectArchive(
      wrongSize as typeof document,
      new Map(),
      [],
      new Map([[sha256, font]]),
    );
    await expect(
      guest.importGuestProject(
        new File([wrong.slice()], "Sign.furrow.zip", { type: "application/zip" }),
      ),
    ).rejects.toThrow("isn't the size the project says");
  });
});

describe("importGuestProject with 3D models", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  async function archiveFile() {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const document = { ...createProjectDocument(), models: [{ ...model, sha256, size: 4 }] };
    const zip = packProjectArchive(document, new Map([[sha256, bytes]]));
    return {
      sha256,
      file: new File([zip.slice()], "Relief.furrow.zip", { type: "application/zip" }),
    };
  }

  it("stores the models' STL files with the project", async () => {
    const { sha256, file } = await archiveFile();
    parseMesh.mockResolvedValue({ sha256, triangles: 1, bounds: model.bounds });
    const project = await guest.importGuestProject(file);
    expect(new Uint8Array(await storage.getGuestAsset(project.id, sha256))).toEqual(bytes);
  });

  it("refuses a damaged STL file, leaving nothing behind", async () => {
    const { file } = await archiveFile();
    parseMesh.mockRejectedValue(new MeshImportError({ code: "stl.sizeMismatch" }));
    await expect(guest.importGuestProject(file)).rejects.toThrow(
      "A model in this file can't be imported: This isn't an STL file, or it is damaged: its size doesn't match.",
    );
    expect(await storage.listGuestProjects()).toEqual([]);
  });
});
