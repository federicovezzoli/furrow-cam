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

/** Delays before asking again for a preview that failed for a passing reason. */
export const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

/**
 * Keeps the previews of the document's models (PRD-0005 S3), drawn by the
 * mesh worker: `update` with the models asks for the previews they lack and
 * forgets those no model needs any more; `receive` files the worker's
 * responses and `onChange` gets the previews by `previewKey` after each
 * change. When the worker doesn't hold a mesh, `loadBytes` fetches its file
 * (cached or downloaded), which is sent with the request again. `fail` gives
 * up on every request at the worker, e.g. when it crashed.
 *
 * A preview that failed for a passing reason (the worker stopped, the file
 * couldn't be downloaded) is asked for again on the next `update` and after
 * each of `RETRY_DELAYS_MS`; one the worker refused (a broken file) isn't.
 * `stop` cancels the retries waiting.
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
  /** The current models by the key of the preview they need. */
  let wanted = new Map<string, Model>();
  /** Keys asked for and not answered yet. */
  const requested = new Set<string>();
  const pending = new Map<number, { key: string; request: PreviewRequest }>();
  /** Keys whose preview failed for a passing reason, with the retries made since. */
  const retryable = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let nextId = 1;

  function send(key: string, request: PreviewRequest) {
    const id = nextId++;
    pending.set(id, { key, request });
    post({ ...request, id });
  }

  function cancelRetry(key: string) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }

  /** Asks for the preview `key`, unless it is filed for good or already asked for. */
  function request(key: string) {
    const model = wanted.get(key);
    if (!model || requested.has(key) || (previews.has(key) && !retryable.has(key))) return;
    cancelRetry(key);
    requested.add(key);
    const { sha256, bounds, placement } = model;
    send(key, { kind: "preview", sha256, bounds, rotation: placement.rotation });
  }

  /** Files `preview`; `passing` errors are kept on screen until asked for again. */
  function settle(key: string, preview: ModelPreview, passing = false) {
    requested.delete(key);
    if (!wanted.has(key)) return;
    if (passing) {
      const retries = retryable.get(key) ?? 0;
      retryable.set(key, retries);
      const delay = RETRY_DELAYS_MS[retries];
      if (delay !== undefined) {
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            retryable.set(key, retries + 1);
            request(key);
          }, delay),
        );
      }
    } else {
      retryable.delete(key);
    }
    previews = new Map(previews).set(key, preview);
    onChange(previews);
  }

  return {
    update(models: readonly Model[]) {
      wanted = new Map(models.map((model) => [previewKey(model), model]));
      for (const key of [...retryable.keys()]) {
        if (!wanted.has(key)) {
          retryable.delete(key);
          cancelRetry(key);
        }
      }
      if ([...previews.keys()].some((key) => !wanted.has(key))) {
        previews = new Map([...previews].filter(([key]) => wanted.has(key)));
        onChange(previews);
      }
      for (const key of wanted.keys()) request(key);
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
          const message = error instanceof Error ? error.message : String(error);
          settle(key, { error: message }, true);
        }
        return;
      }
      if (response.kind === "preview") settle(key, { heightmap: response.heightmap });
      else if (response.kind === "failed") settle(key, { error: response.error });
    },

    fail(error: string) {
      const keys = [...pending.values()].map(({ key }) => key);
      pending.clear();
      for (const key of keys) settle(key, { error }, true);
    },

    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
