import { describe, expect, it } from "vitest";
import {
  dropStep,
  isOnScreen,
  moveTour,
  startTour,
  TOURS,
  type TourStep,
  type TourStepId,
} from "./tour";

// Any ids will do: these steps are never shown.
const step = (id: string): TourStep => ({ id: id as TourStepId, anchor: id, side: "bottom" });
const steps = ["a", "b", "c"].map(step);
const ids = (state: { steps: readonly TourStep[]; index: number } | null) =>
  state && { steps: state.steps.map((s) => s.id), at: state.steps[state.index]?.id };

describe("TOURS", () => {
  it.each(Object.entries(TOURS))("%s tour has unique step ids", (_, tour) => {
    expect(new Set(tour.map((s) => s.id)).size).toBe(tour.length);
  });
});

describe("startTour", () => {
  it("starts at the first step, with every step", () => {
    expect(ids(startTour(steps))).toEqual({ steps: ["a", "b", "c"], at: "a" });
  });
});

describe("moveTour", () => {
  const start = { steps, index: 0 };

  it("moves forward and back", () => {
    const next = moveTour(start, 1);
    expect(ids(next)?.at).toBe("b");
    expect(ids(next && moveTour(next, -1))?.at).toBe("a");
  });

  it("stays on the first step going back", () => {
    expect(moveTour(start, -1)).toEqual(start);
  });

  it("ends after the last step", () => {
    expect(moveTour({ steps, index: 2 }, 1)).toBeNull();
  });
});

describe("dropStep", () => {
  it("going forward, shows the step after the dropped one", () => {
    expect(ids(dropStep({ steps, index: 1 }, 1))).toEqual({ steps: ["a", "c"], at: "c" });
  });

  it("going back, shows the step before the dropped one", () => {
    expect(ids(dropStep({ steps, index: 1 }, -1))).toEqual({ steps: ["a", "c"], at: "a" });
  });

  it("going back from the first step, shows the one after it", () => {
    expect(ids(dropStep({ steps, index: 0 }, -1))).toEqual({ steps: ["b", "c"], at: "b" });
  });

  it("ends the tour when the last step is dropped going forward", () => {
    expect(dropStep({ steps, index: 2 }, 1)).toBeNull();
  });

  it("ends the tour when no step is left", () => {
    expect(dropStep({ steps: [step("a")], index: 0 }, -1)).toBeNull();
  });
});

describe("isOnScreen", () => {
  const viewport = { width: 1000, height: 800 };

  it("accepts a box inside or partly inside the window", () => {
    expect(isOnScreen({ top: 10, left: 10, width: 100, height: 20 }, viewport)).toBe(true);
    expect(isOnScreen({ top: 10, left: 950, width: 100, height: 20 }, viewport)).toBe(true);
  });

  it("rejects a hidden box", () => {
    expect(isOnScreen({ top: 0, left: 0, width: 0, height: 0 }, viewport)).toBe(false);
    expect(isOnScreen({ top: 10, left: 10, width: 100, height: 0 }, viewport)).toBe(false);
  });

  it("rejects a box scrolled out of the window", () => {
    expect(isOnScreen({ top: 10, left: 1000, width: 100, height: 20 }, viewport)).toBe(false);
    expect(isOnScreen({ top: 10, left: -100, width: 100, height: 20 }, viewport)).toBe(false);
    expect(isOnScreen({ top: 900, left: 10, width: 100, height: 20 }, viewport)).toBe(false);
  });
});
