// @vitest-environment jsdom
import { createProjectDocument, type Path, type Point, type Shape } from "@furrow/document";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../../lib/memory-host";
import { useWorkspaceStoreApi } from "../../providers/workspace-stores";
import type { WorkspaceStore } from "../../stores/workspace-store";
import { renderWorkspace } from "../../test-render";
import { PathPick } from "./path-pick";

// The catcher is a three.js plane: here its handlers are called directly, with the ray standing for the point.
const catcher = vi.hoisted(() => ({ props: {} as Record<string, (event: unknown) => void> }));
vi.mock("./stock-top", () => ({
  onStockTop: (ray: { point: Point }) => ray.point,
  useStockTopHover: () => ({}),
  millimetresPerPixel: () => 1,
  canvasHeight: () => 0,
  StockTopCatcher: (props: Record<string, (event: unknown) => void>) => {
    catcher.props = props;
    return null;
  },
}));

const square = (x: number): Path => ({
  start: [x, 0],
  segments: [
    { kind: "line", to: [x + 10, 0] },
    { kind: "line", to: [x + 10, 10] },
    { kind: "line", to: [x, 10] },
  ],
  closed: true,
});
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const shape = (id: string, drawingId: string, paths: Path[]): Shape => ({
  id,
  name: "",
  layer: "",
  drawingId,
  paths,
});
/** Drawing A has two squares, at x 0 and 20; drawing B one, at x 40. */
const geometry = [shape("a", A, [square(0), square(20)]), shape("b", B, [square(40)])];
const IN_A0: Point = [5, 5];
const IN_A1: Point = [25, 5];
const IN_B: Point = [45, 5];
const EMPTY: Point = [100, 100];

type Seen = { store: WorkspaceStore | null };

function Probe({ seen }: { seen: Seen }) {
  seen.store = useWorkspaceStoreApi();
  return null;
}

function render(shapes: Shape[] = geometry): WorkspaceStore {
  const seen: Seen = { store: null };
  const document = {
    ...createProjectDocument(),
    drawings: [A, B].map((id) => ({ id, name: id, border: 10, rotation: 0 })),
    geometry: shapes,
  };
  renderWorkspace(
    <>
      <PathPick />
      <Probe seen={seen} />
    </>,
    createMemoryHost({ document }),
  );
  return seen.store as WorkspaceStore;
}

type Keys = { shift?: boolean; alt?: boolean };
const event = (point: Point, { shift = false, alt = false }: Keys, detail: number) => ({
  delta: 0,
  // Straight down onto the point, as the top view's camera looks.
  ray: {
    point,
    origin: { toArray: () => [point[0], point[1], 1000] },
    direction: { toArray: () => [0, 0, -1] },
  },
  camera: { zoom: 1 },
  shiftKey: shift,
  ctrlKey: false,
  metaKey: false,
  altKey: alt,
  nativeEvent: { detail },
});
const click = (point: Point, keys: Keys = {}) =>
  act(() => catcher.props.onClick?.(event(point, keys, 1)));
/** The two clicks of the pair, then the double click, as the browser sends them. */
const doubleClick = (point: Point, keys: Keys = {}) =>
  act(() => {
    catcher.props.onClick?.(event(point, keys, 1));
    catcher.props.onClick?.(event(point, keys, 2));
    catcher.props.onDoubleClick?.(event(point, keys, 2));
  });

const a0 = { shapeId: "a", path: 0 };
const a1 = { shapeId: "a", path: 1 };
const b0 = { shapeId: "b", path: 0 };

describe("PathPick (ADR-0080)", () => {
  it("selects whole drawings with a click, one path with Alt+click", () => {
    const store = render();
    click(IN_A1);
    expect(store.getState().selectedPaths).toEqual([a0, a1]);
    click(IN_B, { shift: true });
    expect(store.getState().selectedPaths).toEqual([a0, a1, b0]);
    click(IN_A1, { alt: true });
    expect(store.getState().selectedPaths).toEqual([a1]);
    click(EMPTY);
    expect(store.getState().selectedPaths).toEqual([]);
  });

  it("enters a drawing with a double click, and picks only its paths inside it", () => {
    const store = render();
    doubleClick(IN_A1);
    expect(store.getState()).toMatchObject({ enteredDrawingId: A, selectedPaths: [a1] });
    click(IN_A0);
    expect(store.getState().selectedPaths).toEqual([a0]);
    click(IN_A1, { shift: true });
    expect(store.getState().selectedPaths).toEqual([a0, a1]);
    // B is out of reach: the click lands on nothing.
    click(IN_B);
    expect(store.getState()).toMatchObject({ enteredDrawingId: A, selectedPaths: [] });
  });

  it("adds a path with Shift+double click inside the entered drawing", () => {
    const store = render();
    doubleClick(IN_A0);
    doubleClick(IN_A1, { shift: true });
    expect(store.getState()).toMatchObject({ enteredDrawingId: A, selectedPaths: [a0, a1] });
  });

  it("leaves with its paths selected on a double click outside or Esc", () => {
    const store = render();
    doubleClick(IN_A0);
    click(IN_A1, { shift: true });
    doubleClick(EMPTY);
    expect(store.getState()).toMatchObject({ enteredDrawingId: null, selectedPaths: [a0, a1] });

    // Esc too, through the store's `escape` that the viewport calls.
    doubleClick(IN_A0);
    act(() => store.getState().escape());
    expect(store.getState()).toMatchObject({ enteredDrawingId: null, selectedPaths: [a0] });
  });

  it("enters another drawing with a double click on it", () => {
    const store = render();
    doubleClick(IN_A0);
    doubleClick(IN_B);
    expect(store.getState()).toMatchObject({ enteredDrawingId: B, selectedPaths: [b0] });
  });

  it("selects in the orbit view as in the top view: drawings, entered ones' paths, Alt+click (#544)", () => {
    const store = render();
    act(() => store.getState().setView("orbit"));
    click(IN_A1);
    expect(store.getState().selectedPaths).toEqual([a0, a1]);
    click(IN_A1, { alt: true });
    expect(store.getState().selectedPaths).toEqual([a1]);
    doubleClick(IN_A0);
    expect(store.getState()).toMatchObject({ enteredDrawingId: A, selectedPaths: [a0] });
    click(IN_A1, { shift: true });
    expect(store.getState().selectedPaths).toEqual([a0, a1]);
    doubleClick(EMPTY);
    expect(store.getState()).toMatchObject({ enteredDrawingId: null, selectedPaths: [a0, a1] });
  });

  it("leaves when something outside the drawing is selected", () => {
    const store = render();
    doubleClick(IN_A0);
    act(() => store.getState().selectPaths([b0]));
    expect(store.getState().enteredDrawingId).toBeNull();
  });

  it("picks no hidden or locked shape, and leaves them out of a drawing's click (ADR-0080)", () => {
    const [a, b] = geometry as [Shape, Shape];
    const second = { ...a, id: "a2", paths: [square(20)] };
    const store = render([
      { ...a, paths: [square(0)] },
      { ...second, locked: true },
      { ...b, hidden: true },
    ]);
    click(IN_A0);
    expect(store.getState().selectedPaths).toEqual([a0]);
    click(IN_A1);
    expect(store.getState().selectedPaths).toEqual([]);
    click(IN_B);
    expect(store.getState().selectedPaths).toEqual([]);
  });
});
