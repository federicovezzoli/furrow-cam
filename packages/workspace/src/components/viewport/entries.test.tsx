// @vitest-environment jsdom
import {
  createProjectDocument,
  type Operation,
  type Point,
  type ProfileEntry,
} from "@furrow/document";
import { endMill, fullDocument } from "@furrow/document/fixtures";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryHost } from "../../lib/memory-host";
import { useDocumentStoreApi, useWorkspaceStoreApi } from "../../providers/workspace-stores";
import type { DocumentStore } from "../../stores/document-store";
import type { WorkspaceStore } from "../../stores/workspace-store";
import { renderWorkspace } from "../../test-render";
import { Entries } from "./tabs";

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

/** A 100 mm square and a second one at x 200, both profiled outside; the profile selected and its entries edited. */
function render() {
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
    params: { ...profile.params, tabs: null, startPoints: [], entries: [] },
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
      <Entries color="#f00" />
      <Probe seen={seen} />
    </>,
    createMemoryHost({ document }),
  );
  const workspace = seen.workspace as WorkspaceStore;
  act(() => {
    workspace.getState().selectOperation(PROFILE_ID);
    workspace.getState().setEditing("entries");
  });
  const entries = () => {
    const [found] = (seen.document as DocumentStore).getState().document.operations;
    return found?.type === "profile" ? found.params.entries : [];
  };
  return { entries, workspace };
}

const click = (point: Point) =>
  act(() => catcher.props.onClick?.({ delta: 0, ray: { point }, camera: { zoom: 1 } }));

describe("Entries (#427)", () => {
  it("picks the start on a path, then the plunge point anywhere", () => {
    const { entries } = render();
    // Too far from every path: nothing picked.
    click([50, 50]);
    click([-20, 50]);
    expect(entries()).toEqual([]);
    click([2, 30]);
    expect(entries()).toEqual([]);
    click([-20, 30]);
    expect(entries()).toEqual<ProfileEntry[]>([{ start: [0, 30], plunge: [-20, 30] }]);
  });

  it("replaces the entry on the same path, and keeps the other path's", () => {
    const { entries } = render();
    click([0, 30]);
    click([-20, 30]);
    click([300, 50]);
    click([320, 50]);
    click([50, 100]);
    click([50, 120]);
    expect(entries()).toEqual<ProfileEntry[]>([
      { start: [50, 100], plunge: [50, 120] },
      { start: [300, 50], plunge: [320, 50] },
    ]);
  });

  it("drops a half-picked entry when editing ends", () => {
    const { entries, workspace } = render();
    click([0, 30]);
    act(() => workspace.getState().setEditing(null));
    act(() => workspace.getState().setEditing("entries"));
    click([-20, 30]);
    expect(entries()).toEqual([]);
  });
});
