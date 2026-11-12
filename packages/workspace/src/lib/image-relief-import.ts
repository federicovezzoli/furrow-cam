import { type ImageReliefSettings, reliefPixels, type StlLimits } from "@furrow/cam-core";
import { type Message, MessageError } from "@furrow/document";
import type { GeneratedRelief } from "./mesh-worker-protocol";
import { MeshImportError, runMeshWorker } from "./model-import";

const UNREADABLE: Message = { code: "workspace.unreadableFile" };

/** A picked image, read once: its pixels shrunk to what a relief within the limits uses. */
export type ReadImage = {
  image: ImageData;
  /** The picked image's own width and height, in pixels. */
  size: [number, number];
};

/**
 * Reads the PNG, JPEG or WebP `file` (PRD-0015 I1), turned as its EXIF data
 * says and its colours in sRGB, as the browser shows it, then shrunk to the
 * most pixels a relief within `limits` can use, so a large photo is read
 * once and kept small. Throws a `MessageError` saying why it can't.
 */
export async function readImage(file: Blob, limits: StlLimits): Promise<ReadImage> {
  if (file.size > limits.maxBytes) {
    throw new MeshImportError({ code: "image.tooLarge", values: { mb: limits.maxBytes / 1e6 } });
  }
  // Transparency kept apart from the colours, which then count as black (PRD-0015 I3).
  const options = { premultiplyAlpha: "none" } as const;
  let bitmap = await createImageBitmap(file, options).catch(() => {
    throw new MeshImportError(UNREADABLE);
  });
  try {
    const size: [number, number] = [bitmap.width, bitmap.height];
    const [width, height] = reliefPixels(...size, limits);
    if (width < size[0]) {
      const resize = { resizeWidth: width, resizeHeight: height, resizeQuality: "high" } as const;
      const full = bitmap;
      bitmap = await createImageBitmap(full, { ...options, ...resize });
      full.close();
    }
    const context = new OffscreenCanvas(width, height).getContext("2d");
    if (!context) throw new MeshImportError(UNREADABLE);
    context.drawImage(bitmap, 0, 0);
    return { image: context.getImageData(0, 0, width, height), size };
  } catch (error) {
    throw error instanceof MessageError ? error : new MeshImportError(UNREADABLE);
  } finally {
    bitmap.close();
  }
}

/**
 * Builds the relief of `image` in a mesh worker of its own (PRD-0015), which
 * goes away with the mesh; `image` is copied, not transferred, so it can be
 * used again. Aborting `signal` stops the worker. Throws a `MeshImportError`
 * saying why it couldn't.
 */
export async function generateRelief(
  image: ImageData,
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
