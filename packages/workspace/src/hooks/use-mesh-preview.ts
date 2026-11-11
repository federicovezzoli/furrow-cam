import type { StlLimits } from "@furrow/cam-core";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { useEffect, useState } from "react";
import { MeshImportError } from "../lib/model-import";

/**
 * A preview mesh's limits (PRD-0014 T4, PRD-0015 I2): about 220 cells across,
 * a tenth of the model's triangles. Detailed enough to judge; its normals,
 * worked out on the main thread, take about 150 ms on a recent laptop.
 */
export const PREVIEW_LIMITS: StlLimits = { maxBytes: Infinity, maxTriangles: 100_000 };
/** How long settings stay unchanged before the preview is made again. */
const PREVIEW_DELAY = 300;

/**
 * The coarse mesh `make` builds from `input` with `settings`, made again once
 * they stop changing, with the settings it was made with (the last one stays
 * shown while the next is made), or why it couldn't be (`fallback` for an
 * unexpected failure). `null` while the first is made, or with no input.
 * `make` must not change from render to render.
 */
export function useMeshPreview<Input, Settings, Mesh>(
  input: Input | null,
  settings: Settings | null,
  make: (input: Input, settings: Settings, signal: AbortSignal) => Promise<Mesh>,
  fallback: Translatable,
) {
  const [preview, setPreview] = useState<
    { mesh: Mesh; settings: Settings } | { error: Translatable; settings: Settings } | null
  >(null);
  useEffect(() => {
    if (!input || !settings) return setPreview(null);
    const abort = new AbortController();
    const timer = setTimeout(() => {
      make(input, settings, abort.signal).then(
        (mesh) => {
          if (!abort.signal.aborted) setPreview({ mesh, settings });
        },
        (error) => {
          if (abort.signal.aborted) return;
          setPreview({
            settings,
            error: error instanceof MeshImportError ? error.detail : fallback,
          });
        },
      );
    }, PREVIEW_DELAY);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [input, settings, make, fallback]);
  return preview;
}
