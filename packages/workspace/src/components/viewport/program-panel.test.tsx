// @vitest-environment jsdom
import { playbackPath } from "@furrow/cam-core";
import { endMill } from "@furrow/document/fixtures";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createPlaybackStore } from "../../stores/playback-store";
import { renderWorkspace } from "../../test-render";
import { ProgramPanel, programScroll } from "./program-panel";

// Four 10 mm moves along X: line 2's, line 3's and two of line 4's arc.
const segments = Float32Array.of(
  ...[0, 0, 0, 10, 0, 0],
  ...[10, 0, 0, 20, 0, 0],
  ...[20, 0, 0, 30, 0, 0],
  ...[30, 0, 0, 40, 0, 0],
);
const path = playbackPath([{ tool: endMill, segments }]);
const program = {
  gcode: "(Plate)\nG0 X10\nG1 X20\nG2 X40 I10\nM5\n",
  blocks: [{ label: "programEnd" as const, first: 5, last: 5 }],
  moveLines: Uint32Array.of(2, 3, 4, 4),
  warnings: [
    { line: 3, code: "unsupported" as const, word: "A1" },
    { line: 5, code: "unsupported" as const, word: "B1" },
  ],
  failure: null,
};

function setup() {
  const store = createPlaybackStore();
  renderWorkspace(<ProgramPanel store={store} path={path} program={program} />);
  const code = (line: number) =>
    screen.getByText(program.gcode.split("\n")[line - 1] as string).parentElement as HTMLElement;
  return { store, code };
}

describe("ProgramPanel", () => {
  it("highlights the line the playback is on", () => {
    const { store, code } = setup();
    expect(code(2).getAttribute("aria-current")).toBe("true");
    // Before playing, not even the comment before the first move has run.
    expect(code(1).className).not.toContain("emerald");
    act(() => store.getState().setDistance(15));
    expect(code(3).getAttribute("aria-current")).toBe("true");
    // The lines before the one played have run.
    expect(code(1).className).toContain("emerald");
    expect(code(2).className).toContain("emerald");
    expect(code(4).className).not.toContain("emerald");
    expect(code(2).getAttribute("aria-current")).toBeNull();
    act(() => store.getState().setDistance(35));
    expect(code(4).getAttribute("aria-current")).toBe("true");
  });

  it("seeks to a line's first move, and only lines that move are clickable", () => {
    const { store, code } = setup();
    fireEvent.click(code(4));
    expect(store.getState().distance).toBe(20);
    expect(code(4).tagName).toBe("BUTTON");
    expect(code(1).tagName).not.toBe("BUTTON");
    expect(code(5).tagName).not.toBe("BUTTON");
    expect(code(5).title).toBe("Program end block");
  });

  it("links each warning to its line", () => {
    const { store } = setup();
    const warnings = within(screen.getByRole("list", { name: "Program warnings" }));
    fireEvent.click(warnings.getByRole("button", { name: "Line 3: A1 isn't simulated" }));
    expect(store.getState().distance).toBe(10);
    // A line without moves is shown, not played.
    fireEvent.click(warnings.getByRole("button", { name: "Line 5: B1 isn't simulated" }));
    expect(store.getState().distance).toBe(10);
  });

  it("scrolls a program too tall for a browser's box by ratio, to its last line", () => {
    expect(programScroll(100, 800)).toEqual({ height: 2000, ratio: 1 });
    const lines = 2_000_000;
    const { height, ratio } = programScroll(lines, 800);
    expect(height).toBe(10_000_000);
    // Scrolled to the bottom, the view ends at the program's last line.
    expect((height - 800) * ratio + 800).toBeCloseTo(lines * 20);
  });
});
