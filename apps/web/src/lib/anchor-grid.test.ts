import { StockAnchor } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { ANCHOR_GRID, anchorInDirection } from "./anchor-grid";

describe("ANCHOR_GRID", () => {
  it("holds every anchor once", () => {
    expect(ANCHOR_GRID.flat().toSorted()).toEqual(StockAnchor.options.toSorted());
  });
});

describe("anchorInDirection", () => {
  it("moves like the top view: up goes to the top edge", () => {
    expect(anchorInDirection("center", "ArrowUp")).toBe("top_center");
    expect(anchorInDirection("center", "ArrowDown")).toBe("bottom_center");
    expect(anchorInDirection("center", "ArrowLeft")).toBe("middle_left");
    expect(anchorInDirection("center", "ArrowRight")).toBe("middle_right");
  });

  it("stops at the edges of the grid", () => {
    expect(anchorInDirection("top_left", "ArrowUp")).toBe("top_left");
    expect(anchorInDirection("top_left", "ArrowLeft")).toBe("top_left");
    expect(anchorInDirection("bottom_right", "ArrowDown")).toBe("bottom_right");
    expect(anchorInDirection("bottom_right", "ArrowRight")).toBe("bottom_right");
  });

  it("ignores other keys", () => {
    expect(anchorInDirection("center", "Enter")).toBeNull();
  });
});
