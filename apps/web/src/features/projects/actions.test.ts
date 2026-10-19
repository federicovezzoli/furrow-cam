import { createProjectDocument, type Machine, type ProjectDocument } from "@furrow/document";
import { lowRider, machine, model } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "user-1";
const MACHINE_ID = "machine-1";
const UPDATED_AT = new Date("2026-10-16T12:00:00Z");

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  storage: true,
  /** The machine rows, by id, with their owner. */
  machines: new Map<string, Machine & { userId: string }>(),
  created: [] as {
    userId: string;
    name: string;
    machineName: string | null;
    document: ProjectDocument;
  }[],
}));

vi.mock("@/features/auth/server", () => ({ getUserId: async () => mocks.userId }));
vi.mock("@/features/assets/server", () => ({
  MAX_MESH_BYTES: 50_000_000,
  isStorageConfigured: () => mocks.storage,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    machine: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        const row = mocks.machines.get(where.id);
        return row && row.userId === where.userId ? row : null;
      },
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...mocks.machines.entries()]
          .filter(([, row]) => row.userId === where.userId)
          .map(([id, row]) => ({ ...row, id })),
    },
    project: {
      create: async ({ data }: { data: (typeof mocks.created)[number] }) => {
        mocks.created.push(data);
        return { id: "project-1", updatedAt: UPDATED_AT };
      },
    },
  },
}));

const { createProject, importGuestDocument, importProject, startArchiveImport } = await import(
  "./actions"
);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function projectFile(document: ProjectDocument) {
  return new File([JSON.stringify(document)], "Coasters.furrow.json");
}

beforeEach(() => {
  mocks.userId = USER;
  mocks.storage = true;
  mocks.machines.clear();
  mocks.created.length = 0;
});

describe("createProject", () => {
  it("creates a project without a machine when the form names none", async () => {
    await expect(createProject(form({ name: "Board" }))).rejects.toThrow(
      "redirect /projects/project-1",
    );
    expect(mocks.created[0]?.document.machine).toBeNull();
    expect(mocks.created[0]?.machineName).toBeNull();
  });

  it("creates a project without a machine when 'No machine yet' is chosen", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    await expect(createProject(form({ name: "Board", machine: "" }))).rejects.toThrow("redirect");
    expect(mocks.created[0]?.document.machine).toBeNull();
  });

  it("snapshots the chosen machine into the new document", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    await expect(createProject(form({ name: "Board", machine: MACHINE_ID }))).rejects.toThrow(
      "redirect /projects/project-1",
    );
    expect(mocks.created[0]?.document.machine).toEqual(machine);
    expect(mocks.created[0]?.machineName).toBe(machine.name);
  });

  it("rejects another user's machine", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: "someone-else" });
    expect(await createProject(form({ name: "Board", machine: MACHINE_ID }))).toEqual({
      machine: "This machine no longer exists.",
    });
    expect(mocks.created).toHaveLength(0);
  });

  it("rejects a machine whose row fails today's rules", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, safeZ: 500, userId: USER });
    expect(await createProject(form({ name: "Board", machine: MACHINE_ID }))).toHaveProperty(
      "machine",
    );
    expect(mocks.created).toHaveLength(0);
  });
});

describe("importProject", () => {
  it("imports a machine-less file without a machine when the user has none", async () => {
    await expect(importProject(projectFile(createProjectDocument()), null)).rejects.toThrow(
      "redirect /projects/project-1",
    );
    expect(mocks.created[0]?.document.machine).toBeNull();
    expect(mocks.created[0]?.machineName).toBeNull();
  });

  it("imports a machine-less file without a machine when none is given", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    await expect(importProject(projectFile(createProjectDocument()), null)).rejects.toThrow(
      "redirect",
    );
    expect(mocks.created[0]?.document.machine).toBeNull();
  });

  it("gives a machine-less file the chosen machine", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    await expect(importProject(projectFile(createProjectDocument()), MACHINE_ID)).rejects.toThrow(
      "redirect",
    );
    expect(mocks.created[0]?.document.machine).toEqual(machine);
  });

  it("rejects another user's machine for a machine-less file", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: "someone-else" });
    expect(await importProject(projectFile(createProjectDocument()), MACHINE_ID)).toEqual({
      error: "This machine no longer exists.",
    });
    expect(mocks.created).toHaveLength(0);
  });

  it("keeps the file's machine snapshot", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    const document = { ...createProjectDocument(), machine: lowRider };
    await expect(importProject(projectFile(document), MACHINE_ID)).rejects.toThrow("redirect");
    expect(mocks.created[0]?.document.machine).toEqual(lowRider);
    expect(mocks.created[0]?.machineName).toBe(lowRider.name);
  });

  it("refuses a machine-less .furrow.json file with models", async () => {
    const document = { ...createProjectDocument(), models: [model] };
    expect(await importProject(projectFile(document), null)).toEqual({
      error: "This project has 3D models: import its .zip export instead.",
    });
  });

  it("refuses a .furrow.json file with models, whose meshes it can't hold", async () => {
    const document = { ...createProjectDocument(), machine: lowRider, models: [model] };
    expect(await importProject(projectFile(document), MACHINE_ID)).toEqual({
      error: "This project has 3D models: import its .zip export instead.",
    });
    expect(mocks.created).toHaveLength(0);
  });
});

describe("importGuestDocument", () => {
  it("creates the project and returns its id without opening it", async () => {
    const document = { ...createProjectDocument(), units: "in" as const };
    expect(await importGuestDocument(projectFile(document), "Coasters.furrow.json")).toEqual({
      projectId: "project-1",
    });
    expect(mocks.created[0]?.name).toBe("Coasters");
    expect(mocks.created[0]?.document).toEqual(document);
  });

  it("refuses an invalid document or one with models", async () => {
    expect(await importGuestDocument(new File(["[]"], "a.json"), "a.furrow.json")).toHaveProperty(
      "error",
    );
    const withModels = { ...createProjectDocument(), models: [model] };
    expect(await importGuestDocument(projectFile(withModels), "a.furrow.json")).toEqual({
      error: "This project has 3D models: import its .zip export instead.",
    });
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses when signed out", async () => {
    mocks.userId = null;
    expect(
      await importGuestDocument(projectFile(createProjectDocument()), "a.furrow.json"),
    ).toHaveProperty("error");
  });
});

function documentFile(document: ProjectDocument) {
  return new File([JSON.stringify(document)], "project.furrow.json");
}

describe("startArchiveImport", () => {
  const document = { ...createProjectDocument(), machine: lowRider, models: [model] };
  const meshes = [{ sha256: model.sha256, size: model.size }];

  it("creates the project with an empty document and returns the imported one", async () => {
    expect(
      await startArchiveImport(documentFile(document), "Relief.furrow.zip", meshes, null),
    ).toEqual({ projectId: "project-1", document, updatedAt: UPDATED_AT });
    expect(mocks.created[0]?.name).toBe("Relief");
    expect(mocks.created[0]?.machineName).toBe(lowRider.name);
    expect(mocks.created[0]?.document).toEqual({ ...createProjectDocument(), machine: lowRider });
  });

  it("imports a machine-less document without a machine", async () => {
    const machineless = { ...document, machine: null };
    expect(await startArchiveImport(documentFile(machineless), "a.zip", meshes, null)).toEqual({
      projectId: "project-1",
      document: machineless,
      updatedAt: UPDATED_AT,
    });
    expect(mocks.created[0]?.document.machine).toBeNull();
  });

  it("gives a machine-less document the user's machine", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    const machineless = { ...document, machine: null };
    expect(
      await startArchiveImport(documentFile(machineless), "a.zip", meshes, MACHINE_ID),
    ).toMatchObject({ document: { machine } });
    expect(mocks.created[0]?.document.machine).toEqual(machine);
  });

  it("refuses a model whose mesh isn't in the file", async () => {
    expect(await startArchiveImport(documentFile(document), "a.zip", [], null)).toEqual({
      error: "This file can't be imported: the mesh of emblem.stl is missing.",
    });
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a mesh larger than STL import allows", async () => {
    const large = [{ sha256: model.sha256, size: 50_000_001 }];
    expect(await startArchiveImport(documentFile(document), "a.zip", large, null)).toHaveProperty(
      "error",
      expect.stringMatching(/larger than 50 MB/),
    );
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses when this server can't store meshes", async () => {
    mocks.storage = false;
    expect(await startArchiveImport(documentFile(document), "a.zip", meshes, null)).toEqual({
      error: "This project has 3D models, which this server can't store.",
    });
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses an invalid document", async () => {
    expect(
      await startArchiveImport(new File(["[]"], "project.furrow.json"), "a.zip", meshes, null),
    ).toEqual({
      error: "This file isn't a Furrow CAM project.",
    });
  });
});
