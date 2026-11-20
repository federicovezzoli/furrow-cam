// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTabCount } from "./use-tab-count";

describe("useTabCount (#618)", () => {
  it("counts the tabs on each loop, keeping a typed count until that changes", () => {
    const { result, rerender } = renderHook(({ tabs, loops }) => useTabCount(tabs, loops, 4), {
      initialProps: { tabs: 8, loops: 2 },
    });
    expect(result.current[0]).toBe(4);
    act(() => result.current[1](9));
    // A tab moved, or removed where the rounded count stays the same: the typed count stays.
    rerender({ tabs: 8, loops: 2 });
    rerender({ tabs: 7, loops: 2 });
    expect(result.current[0]).toBe(9);
    // An inside profile also takes the holes: 4 contours.
    rerender({ tabs: 8, loops: 4 });
    expect(result.current[0]).toBe(2);
    rerender({ tabs: 0, loops: 4 });
    expect(result.current[0]).toBe(4);
  });
});
