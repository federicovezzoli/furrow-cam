import { beforeEach, describe, expect, it, vi } from "vitest";
import { FreemiumEnv } from "./freemium-env";

const mocks = vi.hoisted(() => ({
  env: {
    FREEMIUM_ENABLED: false,
    FREEMIUM_MAX_PROJECTS: 3 as number | undefined,
    FREEMIUM_MAX_TOOLS: 5 as number | undefined,
    FREEMIUM_MAX_MACHINES: 2 as number | undefined,
    FREEMIUM_MAX_DAILY_EXPORTS: 10 as number | undefined,
  },
  /** Each user's items, by resource. */
  counts: { projects: 0, tools: 0, machines: 0 },
  /** Every query, in order, as `<client>.<what>`. */
  queries: [] as string[],
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/db", () => {
  /** A count of `resource` that records itself as a query of `name`. */
  const counter = (name: string, resource: "projects" | "tools" | "machines") => ({
    count: async () => {
      mocks.queries.push(`${name}.count ${resource}`);
      return mocks.counts[resource];
    },
  });
  const client = (name: string) => ({
    project: counter(name, "projects"),
    tool: counter(name, "tools"),
    machine: counter(name, "machines"),
    $queryRaw: async () => mocks.queries.push(`${name}.lock`),
  });
  const tx = client("tx");
  return {
    db: {
      ...client("db"),
      $transaction: async (fn: (client: unknown) => Promise<unknown>) => {
        mocks.queries.push("db.transaction");
        return fn(tx);
      },
    },
  };
});

const { createWithinLimit, freemiumLimits, limitError, limitMessage, usage } = await import(
  "./limits"
);

beforeEach(() => {
  mocks.env.FREEMIUM_ENABLED = false;
  mocks.counts = { projects: 0, tools: 0, machines: 0 };
  mocks.queries.length = 0;
});

/** Creates with a stand-in insert that records which client it ran on. */
function create(resource: "projects" | "tools" | "machines") {
  return createWithinLimit("user-1", resource, async (client) => {
    const name = (client as { $transaction?: unknown }).$transaction ? "db" : "tx";
    mocks.queries.push(`${name}.insert`);
    return "row";
  });
}

describe("with the flag off", () => {
  it("limits nothing and runs no extra query (F1, F9)", async () => {
    mocks.counts.projects = 100;
    expect(freemiumLimits()).toBeNull();
    expect(await create("projects")).toEqual({ created: "row" });
    expect(await limitError({} as never, "user-1", "tools")).toBeNull();
    expect(await usage("user-1")).toBeNull();
    expect(mocks.queries).toEqual(["db.insert"]);
  });
});

describe("with the flag on", () => {
  beforeEach(() => {
    mocks.env.FREEMIUM_ENABLED = true;
  });

  const limits = { projects: 3, tools: 5, machines: 2 } as const;
  for (const resource of ["projects", "tools", "machines"] as const) {
    const limit = limits[resource];

    it(`creates ${resource} under the limit, counting under a lock in the insert's transaction`, async () => {
      mocks.counts[resource] = limit - 1;
      expect(await create(resource)).toEqual({ created: "row" });
      expect(mocks.queries).toEqual([
        "db.transaction",
        "tx.lock",
        `tx.count ${resource}`,
        "tx.insert",
      ]);
    });

    it(`refuses ${resource} at and above the limit (F3), inserting nothing`, async () => {
      for (const count of [limit, limit + 4]) {
        mocks.counts[resource] = count;
        mocks.queries.length = 0;
        expect(await create(resource)).toEqual({ error: limitMessage(resource, limit) });
        expect(mocks.queries).not.toContain("tx.insert");
      }
    });
  }

  it("says what the limit is and how to get under it", () => {
    expect(limitMessage("projects", 3)).toBe(
      "You've reached the free plan's limit of 3 projects. Delete a project to create a new one.",
    );
    expect(limitMessage("tools", 1)).toBe(
      "You've reached the free plan's limit of 1 bit. Delete a bit to create a new one.",
    );
  });

  it("reports the limits and the user's usage (F8)", async () => {
    mocks.counts = { projects: 1, tools: 6, machines: 0 };
    expect(freemiumLimits()).toEqual({ projects: 3, tools: 5, machines: 2, dailyExports: 10 });
    expect(await usage("user-1")).toEqual({
      projects: { used: 1, limit: 3 },
      tools: { used: 6, limit: 5 },
      machines: { used: 0, limit: 2 },
    });
  });
});

describe("FreemiumEnv", () => {
  const limits = {
    FREEMIUM_MAX_PROJECTS: "3",
    FREEMIUM_MAX_TOOLS: "5",
    FREEMIUM_MAX_MACHINES: "2",
    FREEMIUM_MAX_DAILY_EXPORTS: "10",
  };

  it("is off by default, with no limit needed", () => {
    expect(FreemiumEnv.parse({})).toEqual({ FREEMIUM_ENABLED: false });
    expect(FreemiumEnv.parse({ FREEMIUM_ENABLED: "false" }).FREEMIUM_ENABLED).toBe(false);
  });

  it("needs every limit, a positive integer, when on (F2)", () => {
    expect(FreemiumEnv.parse({ FREEMIUM_ENABLED: "true", ...limits })).toEqual({
      FREEMIUM_ENABLED: true,
      FREEMIUM_MAX_PROJECTS: 3,
      FREEMIUM_MAX_TOOLS: 5,
      FREEMIUM_MAX_MACHINES: 2,
      FREEMIUM_MAX_DAILY_EXPORTS: 10,
    });
    const { FREEMIUM_MAX_TOOLS: _, ...withoutTools } = limits;
    expect(
      FreemiumEnv.safeParse({ FREEMIUM_ENABLED: "true", ...withoutTools }).error?.issues,
    ).toEqual([expect.objectContaining({ path: ["FREEMIUM_MAX_TOOLS"] })]);
    for (const bad of ["0", "-1", "2.5", "many"]) {
      expect(
        FreemiumEnv.safeParse({ FREEMIUM_ENABLED: "true", ...limits, FREEMIUM_MAX_PROJECTS: bad })
          .success,
      ).toBe(false);
    }
    expect(FreemiumEnv.safeParse({ FREEMIUM_ENABLED: "maybe" }).success).toBe(false);
  });
});
