import type { Heightmap } from "@furrow/cam-core";
import type { Model } from "@furrow/document";
import type { MeshRequest, MeshResponse } from "@/features/workspace/lib/mesh-worker-protocol";

/** A model as seen from above, to draw it as it will be cut, or why it can't be shown. */
export type ModelPreview =
  | { heightmap: Heightmap | null; error?: never }
  | { error: string; heightmap?: never };

type PreviewRequest = Omit<Extract<MeshRequest, { kind: "preview" }>, "id">;

/**
 * Previews depend on the mesh and its rotation only: scaling and moving a
 * model scales and moves its preview, without drawing it again.
 */
export function previewKey({ sha256, placement }: Pick<Model, "sha256" | "placement">) {
  return `${sha256}:${placement.rotation.join(",")}`;
}

/**
 * Keeps the previews of the document's models (PRD-0005 S3), drawn by the
 * mesh worker: `update` with the models asks for the previews they lack and
 * forgets those no model needs any more; `receive` files the worker's
 * responses and `onChange` gets the previews by `previewKey` after each
 * change. When the worker doesn't hold a mesh, `loadBytes` fetches its file
 * (cached or downloaded), which is sent with the request again. `fail` gives
 * up on every request at the worker, e.g. when it crashed.
 */
export function scheduleModelPreviews({
  post,
  loadBytes,
  onChange,
}: {
  post: (request: MeshRequest) => void;
  loadBytes: (sha256: string) => Promise<ArrayBuffer>;
  onChange: (previews: ReadonlyMap<string, ModelPreview>) => void;
}) {
  let previews = new Map<string, ModelPreview>();
  /** Keys the current models need. */
  let wanted = new Set<string>();
  /** Keys asked for and not answered yet. */
  const requested = new Set<string>();
  const pending = new Map<number, { key: string; request: PreviewRequest }>();
  let nextId = 1;

  function send(key: string, request: PreviewRequest) {
    const id = nextId++;
    pending.set(id, { key, request });
    post({ ...request, id });
  }

  function settle(key: string, preview: ModelPreview) {
    requested.delete(key);
    if (!wanted.has(key)) return;
    previews = new Map(previews).set(key, preview);
    onChange(previews);
  }

  return {
    update(models: readonly Model[]) {
      wanted = new Set(models.map(previewKey));
      if ([...previews.keys()].some((key) => !wanted.has(key))) {
        previews = new Map([...previews].filter(([key]) => wanted.has(key)));
        onChange(previews);
      }
      for (const model of models) {
        const key = previewKey(model);
        if (previews.has(key) || requested.has(key)) continue;
        requested.add(key);
        const { sha256, bounds, placement } = model;
        send(key, { kind: "preview", sha256, bounds, rotation: placement.rotation });
      }
    },

    async receive(response: MeshResponse) {
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      const { key, request } = entry;
      if (response.kind === "missing") {
        if (request.bytes) {
          settle(key, { error: "The model couldn't be read." });
          return;
        }
        try {
          send(key, { ...request, bytes: await loadBytes(request.sha256) });
        } catch (error) {
          settle(key, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (response.kind === "preview") settle(key, { heightmap: response.heightmap });
      else if (response.kind === "failed") settle(key, { error: response.error });
    },

    fail(error: string) {
      const keys = [...pending.values()].map(({ key }) => key);
      pending.clear();
      for (const key of keys) settle(key, { error });
    },
  };
}
