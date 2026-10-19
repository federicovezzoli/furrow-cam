import "fake-indexeddb/auto";
import { CURRENT_SCHEMA_VERSION, createProjectDocument } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The archive reader's module also holds the account import, which calls server actions.
vi.mock("@/features/projects/actions", () => ({}));
vi.mock("@/features/assets/lib/mesh-cache", () => ({}));
vi.mock("@/features/assets/lib/meshes", () => ({}));

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
