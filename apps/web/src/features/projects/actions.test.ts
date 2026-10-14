import { createProjectDocument, type Machine, type ProjectDocument } from "@furrow/document";
import { lowRider, machine } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "user-1";
const MACHINE_ID = "machine-1";

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | null,
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
        return { id: "project-1" };
      },
    },
  },
}));

const { createProject, importProject } = await import("./actions");

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
  mocks.machines.clear();
  mocks.created.length = 0;
});

describe("createProject", () => {
  it("rejects a missing machine, e.g. when the user has none", async () => {
    expect(await createProject(form({ name: "Board" }))).toEqual({ machine: "Choose a machine." });
    expect(mocks.created).toHaveLength(0);
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
  it("rejects a machine-less file when the user has no machine", async () => {
    expect(await importProject(projectFile(createProjectDocument()), null)).toEqual({
      error: "Add a machine before importing a project.",
    });
    expect(mocks.created).toHaveLength(0);
  });

  it("rejects a machine-less file when none of the user's machines is valid", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, safeZ: 500, userId: USER });
    expect(await importProject(projectFile(createProjectDocument()), null)).toEqual({
      error: "Add a machine before importing a project.",
    });
  });

  it("asks for a machine for a machine-less file", async () => {
    mocks.machines.set(MACHINE_ID, { ...machine, userId: USER });
    expect(await importProject(projectFile(createProjectDocument()), null)).toEqual({
      chooseMachine: true,
    });
    expect(mocks.created).toHaveLength(0);
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
});
