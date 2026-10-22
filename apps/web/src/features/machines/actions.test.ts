import { machine } from "@furrow/document/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MACHINE_ID = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";

const mocks = vi.hoisted(() => ({
  revalidated: [] as [string, string | undefined][],
  updated: 1,
}));

vi.mock("@/features/auth/server", () => ({ getUserId: async () => "user-1" }));
vi.mock("./server", () => ({ parseMachineForm: () => ({ machine }) }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => mocks.revalidated.push([path, type]),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    machine: {
      create: async () => ({}),
      updateMany: async () => ({ count: mocks.updated }),
    },
  },
}));

const { saveMachine } = await import("./actions");

describe("saveMachine", () => {
  beforeEach(() => {
    mocks.revalidated = [];
    mocks.updated = 1;
  });

  it("stays on the page after updating and refreshes every page that lists machines", async () => {
    await expect(saveMachine(MACHINE_ID, new FormData())).resolves.toEqual({});
    expect(mocks.revalidated).toEqual([["/", "layout"]]);
  });

  it("redirects to the list after creating", async () => {
    await expect(saveMachine(null, new FormData())).rejects.toThrow("redirect /machines");
    expect(mocks.revalidated).toEqual([["/", "layout"]]);
  });

  it("reports a machine that isn't the user's", async () => {
    mocks.updated = 0;
    await expect(saveMachine(MACHINE_ID, new FormData())).resolves.toEqual({
      form: { key: "Machines.notFound" },
    });
    expect(mocks.revalidated).toEqual([]);
  });
});
