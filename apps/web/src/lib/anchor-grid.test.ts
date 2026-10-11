import { StockAnchor } from "@furrow/document";
import { describe, expect, it } from "vitest";
import { ANCHOR_GRID, zeroChoiceInDirection } from "./anchor-grid";

describe("ANCHOR_GRID", () => {
  it("holds every anchor once", () => {
    expect(ANCHOR_GRID.flat().toSorted()).toEqual(StockAnchor.options.toSorted());
  });
});

describe("zeroChoiceInDirection", () => {
  it("moves like the top view: up goes to the top edge", () => {
    expect(zeroChoiceInDirection("center", "ArrowUp")).toBe("top_center");
    expect(zeroChoiceInDirection("center", "ArrowDown")).toBe("bottom_center");
    expect(zeroChoiceInDirection("center", "ArrowLeft")).toBe("middle_left");
    expect(zeroChoiceInDirection("center", "ArrowRight")).toBe("middle_right");
  });

  it("stops at the grid's top, left and right edges", () => {
    expect(zeroChoiceInDirection("top_left", "ArrowUp")).toBe("top_left");
    expect(zeroChoiceInDirection("top_left", "ArrowLeft")).toBe("top_left");
    expect(zeroChoiceInDirection("middle_right", "ArrowRight")).toBe("middle_right");
    expect(zeroChoiceInDirection("bottom_center", "ArrowRight")).toBe("bottom_right");
  });

  it("reaches Custom past the bottom row and the bottom-right corner", () => {
    expect(zeroChoiceInDirection("bottom_left", "ArrowDown")).toBe("custom");
    expect(zeroChoiceInDirection("bottom_right", "ArrowDown")).toBe("custom");
    expect(zeroChoiceInDirection("bottom_right", "ArrowRight")).toBe("custom");
  });

  it("goes back from Custom to the bottom-right corner", () => {
    expect(zeroChoiceInDirection("custom", "ArrowUp")).toBe("bottom_right");
    expect(zeroChoiceInDirection("custom", "ArrowLeft")).toBe("bottom_right");
    expect(zeroChoiceInDirection("custom", "ArrowDown")).toBe("custom");
    expect(zeroChoiceInDirection("custom", "ArrowRight")).toBe("custom");
  });

  it("ignores other keys, including inherited object keys", () => {
    expect(zeroChoiceInDirection("center", "Enter")).toBeNull();
    expect(zeroChoiceInDirection("center", "constructor")).toBeNull();
  });

  it("ignores a choice that isn't in the grid", () => {
    expect(zeroChoiceInDirection("nowhere" as StockAnchor, "ArrowUp")).toBeNull();
  });
});
