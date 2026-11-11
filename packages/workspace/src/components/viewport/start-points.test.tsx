// @vitest-environment jsdom
import {
  createProjectDocument,
  type Operation,
  type Point,
  type ProfileStartPoint,
} from "@furrow/document";
import { endMill, fullDocument } from "@furrow/document/fixtures";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../../providers/workspace-stores";
import type { DocumentStore } from "../../stores/document-store";
import type { WorkspaceStore } from "../../stores/workspace-store";
import { renderWorkspace } from "../../test-render";
import { StartPoints } from "./tabs";

// The catcher is a three.js plane: here its handlers are called directly, with the ray standing for the point.
const catcher = vi.hoisted(() => ({ props: {} as Record<string, (event: unknown) => void> }));
vi.mock("./stock-top", () => ({
  onStockTop: (ray: { point: Point }) => ray.point,
  useStockTopHover: () => ({}),
  StockTopCatcher: (props: Record<string, (event: unknown) => void>) => {
    catcher.props = props;
    return null;
  },
}));
// No canvas: the markers render nothing, and nothing runs per frame.
vi.mock("@react-three/fiber", () => ({ useFrame: () => {} }));
vi.mock("@react-three/drei", () => ({ Edges: () => null }));
vi.mock("./lines", () => ({ Lines: () => null, DashedLines: () => null }));

const PROFILE_ID = "11111111-2222-4333-8444-555555555555";
const SHAPE_ID = "4f8a1c2e-6b3d-4e5f-9a7b-8c9d0e1f2a3b";

type Seen = { document: DocumentStore | null; workspace: WorkspaceStore | null };

function Probe({ seen }: { seen: Seen }) {
  seen.document = useDocumentStoreApi();
  seen.workspace = useWorkspaceStoreApi();
  return null;
}

/** A 100 mm square and a second one at x 200, both profiled outside; the profile selected and its start points edited. */
function render(tabs = false) {
  const [profile] = fullDocument().operations;
  if (profile?.type !== "profile") throw new Error("fullDocument has a profile");
  const square = (x: number) => ({
    start: [x, 0] as Point,
    segments: [
      { kind: "line" as const, to: [x + 100, 0] as Point },
      { kind: "line" as const, to: [x + 100, 100] as Point },
      { kind: "line" as const, to: [x, 100] as Point },
    ],
    closed: true,
  });
  const base = createProjectDocument();
  const operation: Operation = {
    ...profile,
    id: PROFILE_ID,
    tool: endMill,
    targets: [{ shapeId: SHAPE_ID, paths: null }],
    params: {
      ...profile.params,
      tabs: tabs ? { width: 8, height: 3, positions: [] } : null,
      startPoints: [],
    },
  };
  const document = {
    ...base,
    drawings: [{ id: profile.id, name: "d", border: 10, rotation: 0 }],
    geometry: [
      { id: SHAPE_ID, name: "", layer: "", drawingId: profile.id, paths: [square(0), square(200)] },
    ],
    operations: [operation],
  };
  const seen: Seen = { document: null, workspace: null };
  renderWorkspace(
    <>
      <StartPoints color="#f00" />
      <Probe seen={seen} />
    </>,
    createMemoryHost({ document }),
  );
  const workspace = seen.workspace as WorkspaceStore;
  act(() => {
    workspace.getState().selectOperation(PROFILE_ID);
    workspace.getState().setEditing("startPoints");
  });
  const startPoints = () => {
    const [found] = (seen.document as DocumentStore).getState().document.operations;
    return found?.type === "profile" ? found.params.startPoints : [];
  };
  return { startPoints, workspace };
}

const click = (point: Point) =>
  act(() => catcher.props.onClick?.({ delta: 0, ray: { point }, camera: { zoom: 1 } }));

describe("StartPoints plunge points (#427)", () => {
  it("gives the start point just placed on a closed path the next click away from the paths", () => {
    const { startPoints } = render();
    // Away from the paths with no start point just placed: nothing.
    click([-20, 30]);
    expect(startPoints()).toEqual([]);
    click([2, 30]);
    click([-20, 30]);
    expect(startPoints()).toEqual<ProfileStartPoint[]>([{ start: [0, 30], plunge: [-20, 30] }]);
    // Only once: the next click away from the paths does nothing.
    click([-30, 30]);
    expect(startPoints()).toEqual<ProfileStartPoint[]>([{ start: [0, 30], plunge: [-20, 30] }]);
  });

  it("adds start points without plunge points when clicks stay on the paths", () => {
    const { startPoints } = render();
    click([0, 30]);
    click([300, 50]);
    expect(startPoints()).toEqual<ProfileStartPoint[]>([
      { start: [0, 30], plunge: null },
      { start: [300, 50], plunge: null },
    ]);
  });

  it("gives no plunge point with tabs", () => {
    const withTabs = render(true);
    click([0, 30]);
    click([-20, 30]);
    expect(withTabs.startPoints()).toEqual<ProfileStartPoint[]>([{ start: [0, 30], plunge: null }]);
  });

  it("drops a half-made pick when editing ends", () => {
    const { startPoints, workspace } = render();
    click([0, 30]);
    act(() => workspace.getState().setEditing(null));
    act(() => workspace.getState().setEditing("startPoints"));
    click([-20, 30]);
    expect(startPoints()).toEqual<ProfileStartPoint[]>([{ start: [0, 30], plunge: null }]);
  });
});
