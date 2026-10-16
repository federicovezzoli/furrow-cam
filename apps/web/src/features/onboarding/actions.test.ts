import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
}));

vi.mock("@/features/auth/server", () => ({ getUserId: async () => mocks.userId }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      updateMany: async (args: (typeof mocks.updates)[number]) => {
        mocks.updates.push(args);
        return { count: 1 };
      },
    },
  },
}));

const { finishTour } = await import("./actions");

beforeEach(() => {
  mocks.userId = "user-1";
  mocks.updates = [];
});

describe("finishTour", () => {
  it.each([
    ["app", "appTourDoneAt"],
    ["workspace", "workspaceTourDoneAt"],
  ])("stores when the %s tour was first finished", async (tour, column) => {
    await finishTour(tour);
    expect(mocks.updates).toEqual([
      { where: { id: "user-1", [column]: null }, data: { [column]: expect.any(Date) } },
    ]);
  });

  it("ignores an unknown tour", async () => {
    await finishTour("emailVerified");
    expect(mocks.updates).toEqual([]);
  });

  it("ignores a signed-out user", async () => {
    mocks.userId = null;
    await finishTour("app");
    expect(mocks.updates).toEqual([]);
  });
});
