import type { Heightmap } from "@furrow/cam-core";
import type { Model } from "@furrow/document";
import { model } from "@furrow/document/fixtures";
import { describe, expect, it, vi } from "vitest";
import type { MeshRequest } from "@/features/workspace/lib/mesh-worker-protocol";
import { type ModelPreview, previewKey, scheduleModelPreviews } from "./model-preview-scheduler";

const heightmap: Heightmap = {
  columns: 2,
  rows: 2,
  cellWidth: 1,
  cellHeight: 1,
  heights: new Float32Array(4),
};

function setup(loadBytes = async () => new ArrayBuffer(8)) {
  const posted: MeshRequest[] = [];
  let previews: ReadonlyMap<string, ModelPreview> = new Map();
  const schedule = scheduleModelPreviews({
    post: (request) => posted.push(request),
    loadBytes: vi.fn(loadBytes),
    onChange: (next) => {
      previews = next;
    },
  });
  return { schedule, posted, previews: () => previews };
}

const turned: Model = {
  ...model,
  id: "f3a4c1d2-0000-4000-8000-000000000002",
  placement: { ...model.placement, rotation: [0, 0, 90] },
};

describe("scheduleModelPreviews", () => {
  it("asks once per mesh and rotation, whatever the scale or position", () => {
    const { schedule, posted } = setup();
    const moved = { ...model, placement: { ...model.placement, scale: 3, position: [5, 5] } };
    schedule.update([model]);
    schedule.update([moved as Model]);
    expect(posted).toEqual([
      expect.objectContaining({ kind: "preview", sha256: model.sha256, rotation: [0, 0, 0] }),
    ]);
    schedule.update([turned]);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ rotation: [0, 0, 90] });
  });

  it("files previews and forgets those no model needs", async () => {
    const { schedule, posted, previews } = setup();
    schedule.update([model, turned]);
    await schedule.receive({ kind: "preview", id: (posted[0] as MeshRequest).id, heightmap });
    await schedule.receive({ kind: "failed", id: (posted[1] as MeshRequest).id, error: "Broken." });
    expect(previews().get(previewKey(model))).toEqual({ heightmap });
    expect(previews().get(previewKey(turned))).toEqual({ error: "Broken." });
    schedule.update([turned]);
    expect([...previews().keys()]).toEqual([previewKey(turned)]);
    // Needed again: asked for again.
    schedule.update([model, turned]);
    expect(posted).toHaveLength(3);
  });

  it("sends the file again when the worker doesn't hold the mesh", async () => {
    const { schedule, posted, previews } = setup();
    schedule.update([model]);
    await schedule.receive({ kind: "missing", id: (posted[0] as MeshRequest).id });
    expect(posted[1]).toMatchObject({ kind: "preview", sha256: model.sha256 });
    expect(posted[1]).toHaveProperty("bytes");
    await schedule.receive({ kind: "missing", id: (posted[1] as MeshRequest).id });
    expect(previews().get(previewKey(model))).toEqual({ error: "The model couldn't be read." });
  });

  it("reports a file that can't be loaded", async () => {
    const { schedule, posted, previews } = setup(async () => {
      throw new Error("Offline.");
    });
    schedule.update([model]);
    await schedule.receive({ kind: "missing", id: (posted[0] as MeshRequest).id });
    expect(previews().get(previewKey(model))).toEqual({ error: "Offline." });
  });

  it("gives up on pending requests when the worker fails, and ignores stale responses", async () => {
    const { schedule, posted, previews } = setup();
    schedule.update([model]);
    schedule.fail("The worker stopped.");
    expect(previews().get(previewKey(model))).toEqual({ error: "The worker stopped." });
    await schedule.receive({ kind: "preview", id: (posted[0] as MeshRequest).id, heightmap });
    expect(previews().get(previewKey(model))).toEqual({ error: "The worker stopped." });
  });
});
