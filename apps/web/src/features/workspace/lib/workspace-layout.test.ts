import { describe, expect, it } from "vitest";
import { parseWorkspaceLayout, savedLayout } from "./workspace-layout";

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

describe("parseWorkspaceLayout", () => {
  it("reads both groups and ignores an unreadable cookie", () => {
    const layout = {
      columns: { sidebar: 30, viewport: 70 },
      sidebar: { operations: 40, properties: 60 },
    };
    expect(parseWorkspaceLayout(JSON.stringify(layout))).toEqual(layout);
    expect(parseWorkspaceLayout("{")).toEqual({});
  });
});
