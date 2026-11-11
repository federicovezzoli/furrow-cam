import type { ImageReliefSettings, StlLimits } from "@furrow/cam-core";
import type { Message } from "@furrow/document";
import type { GeneratedRelief } from "./mesh-worker-protocol";
import { MeshImportError, runMeshWorker } from "./model-import";

const UNREADABLE: Message = { code: "workspace.unreadableFile" };

/**
 * Builds the relief of the PNG, JPEG or WebP `image` in a mesh worker of its
 * own (PRD-0015), which goes away with the mesh; `image` is copied, not
 * transferred, so it can be used again. Aborting `signal` stops the worker.
 * Throws a `MeshImportError` saying why it couldn't.
 */
export async function generateRelief(
  image: ArrayBuffer,
  settings: ImageReliefSettings,
  limits: StlLimits,
  options: { signal?: AbortSignal } = {},
): Promise<GeneratedRelief> {
  const request = { kind: "image", id: 0, image, settings, limits } as const;
  const data = await runMeshWorker(request, [], UNREADABLE, options);
  if (data.kind !== "image") throw new MeshImportError(UNREADABLE);
  const { kind: _, id: __, ...relief } = data;
  return relief;
}

/** The image's width and height in pixels, or `null` if the browser can't read it. */
export async function imageSize(image: Blob): Promise<[number, number] | null> {
  try {
    const bitmap = await createImageBitmap(image);
    const size: [number, number] = [bitmap.width, bitmap.height];
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
