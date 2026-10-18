import { describe, expect, it } from "vitest";
import { savedLayout, toggledPaneLayout, toWorkspaceLayout } from "./workspace-layout";

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
  it("reads both groups and ignores anything else", () => {
    const layout = {
      columns: { sidebar: 30, viewport: 70 },
      sidebar: { operations: 40, properties: 60 },
    };
    expect(toWorkspaceLayout(layout)).toEqual(layout);
    expect(toWorkspaceLayout({ columns: { sidebar: 130 } })).toEqual({});
    expect(toWorkspaceLayout(null)).toEqual({});
  });
});

describe("toggledPaneLayout", () => {
  const panes = ["a", "b", "c"];
  const toggle = (layout: Record<string, number>, collapsed: string[], target: string) =>
    toggledPaneLayout({
      layout,
      panes,
      rest: "rest",
      collapsed: new Set(collapsed),
      target,
      headerSize: 5,
      openSize: 40,
      minSize: 10,
    });

  it("gives a collapsing pane's space to the nearest open pane, below first", () => {
    expect(toggle({ a: 30, b: 40, c: 30, rest: 0 }, [], "a")).toEqual({
      a: 5,
      b: 65,
      c: 30,
      rest: 0,
    });
    expect(toggle({ a: 30, b: 5, c: 65, rest: 0 }, ["b"], "a")).toEqual({
      a: 5,
      b: 5,
      c: 90,
      rest: 0,
    });
    expect(toggle({ a: 65, b: 5, c: 30, rest: 0 }, ["b"], "c")).toEqual({
      a: 90,
      b: 5,
      c: 5,
      rest: 0,
    });
  });

  it("leaves the space empty when the last open pane collapses", () => {
    expect(toggle({ a: 5, b: 90, c: 5, rest: 0 }, ["a", "c"], "b")).toEqual({
      a: 5,
      b: 5,
      c: 5,
      rest: 85,
    });
  });

  it("fills the sidebar with the only open pane", () => {
    expect(toggle({ a: 5, b: 5, c: 5, rest: 85 }, ["a", "b", "c"], "c")).toEqual({
      a: 5,
      b: 5,
      c: 90,
      rest: 0,
    });
  });

  it("expands a pane from the open ones without collapsing them", () => {
    const layout = toggle({ a: 90, b: 5, c: 5, rest: 0 }, ["b", "c"], "b");
    expect(layout).toEqual({ a: 55, b: 40, c: 5, rest: 0 });
    // Empty space first, then from each open pane in proportion to what it has above its minimum.
    expect(toggle({ a: 15, b: 75, c: 5, rest: 5 }, ["c"], "c")).toEqual({
      a: expect.closeTo(15 - (5 * 30) / 70),
      b: expect.closeTo(75 - (65 * 30) / 70),
      c: 40,
      rest: 0,
    });
  });
});
