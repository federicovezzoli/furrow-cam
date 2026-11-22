import { describe, expect, it, vi } from "vitest";

const ACCOUNT_PROJECT = "00000000-0000-4000-8000-000000000001";
const GUEST_PROJECT = "00000000-0000-4000-8000-000000000002";

const count = vi.hoisted(() =>
  vi.fn(async ({ where }: { where: { id: string } }) => (where.id === ACCOUNT_PROJECT ? 1 : 0)),
);
vi.mock("@/lib/db", () => ({ db: { project: { count } } }));

const { isAccountProject } = await import("./server");

describe("isAccountProject", () => {
  it("finds an account's project whoever owns it", async () => {
    expect(await isAccountProject(ACCOUNT_PROJECT)).toBe(true);
  });

  it("doesn't find a project kept only in a browser", async () => {
    expect(await isAccountProject(GUEST_PROJECT)).toBe(false);
  });

  it("doesn't query for an id that can't be a project's", async () => {
    count.mockClear();
    expect(await isAccountProject("not-a-uuid")).toBe(false);
    expect(count).not.toHaveBeenCalled();
  });
});
