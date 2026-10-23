import { describe, expect, it } from "vitest";
import { savedLayout, toWorkspaceLayout } from "./workspace-layout";

describe("savedLayout", () => {
  it("keeps a layout that sizes exactly the panels there are", () => {
    const layout = { sidebar: 30, viewport: 70 };
    expect(savedLayout(layout, ["sidebar", "viewport"])).toBe(layout);
  });

  it("drops a layout saved for other panels", () => {
    expect(
      savedLayout({ sidebar: 20, viewport: 60, properties: 20 }, ["sidebar", "viewport"]),
    ).toBeUndefined();
    expect(savedLayout({ geometry: 50, operations: 50 }, ["operations", "properties"])).toBe(
      undefined,
    );
  });

  it("has nothing to keep without a layout", () => {
    expect(savedLayout(undefined, ["sidebar", "viewport"])).toBeUndefined();
  });
});

describe("toWorkspaceLayout", () => {
  it("reads the columns and ignores anything else", () => {
    const layout = { columns: { sidebar: 30, viewport: 70 } };
    expect(toWorkspaceLayout({ ...layout, sidebar: { operations: 40 } })).toEqual(layout);
    expect(toWorkspaceLayout({ columns: { sidebar: 130 } })).toEqual({});
    expect(toWorkspaceLayout(null)).toEqual({});
  });
});
