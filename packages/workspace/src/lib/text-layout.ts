import { type Message, MessageError, type Path, Sha256, type TextSettings } from "@furrow/document";

/** An uploaded font's file and whether it is single-stroke (ADR-0062). */
export type UploadedFontFile = { bytes: ArrayBuffer; singleStroke: boolean };

/** Reads the project's uploaded font `sha256`; throws if it can't. */
export type UploadedFonts = (sha256: string) => Promise<UploadedFontFile>;

/**
 * A text item's settings to lay out, `id` pairing the answer with it, and the
 * uploaded font they use the first time this worker needs it.
 */
export type TextLayoutRequest = { id: number; settings: TextSettings; font?: UploadedFontFile };

/** Its outlines in stock coordinates, or why there are none, for the user. */
export type TextLayoutResponse = { id: number; paths: Path[] } | { id: number; error: Message };

/** Why a text item couldn't be laid out, for the user (ADR-0054). */
export class TextLayoutError extends MessageError {}

/** Why text couldn't be laid out, when nothing more precise is known. */
export const TEXT_LAYOUT_FAILED: Message = { code: "workspace.textLayoutFailed" };

let worker: Worker | null = null;
const waiting = new Map<
  number,
  { font: string; resolve: (paths: Path[]) => void; reject: (error: Error) => void }
>();
let nextId = 0;
/** The uploaded fonts the running worker was sent, by hash. */
const sent = new Set<string>();

/**
 * Text item `settings`' outlines in stock coordinates (`textPaths`), laid
 * out in a Web Worker (ADR-0004) that stays for the next edit, with the fonts
 * it loaded. An uploaded font is read through `uploaded` and sent to the
 * worker the first time it needs it. Throws a `TextLayoutError` if the text
 * can't be laid out.
 */
export async function layoutText(
  settings: TextSettings,
  uploaded?: UploadedFonts,
): Promise<Path[]> {
  let font: UploadedFontFile | undefined;
  if (Sha256.safeParse(settings.font).success && !sent.has(settings.font)) {
    try {
      if (!uploaded) throw new Error("No uploaded fonts to read");
      font = await uploaded(settings.font);
    } catch (error) {
      console.error(error);
      throw new TextLayoutError({ code: "workspace.fontUnavailable" });
    }
    sent.add(settings.font);
  }
  const running = worker ?? start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { font: settings.font, resolve, reject });
    const request: TextLayoutRequest = font ? { id, settings, font } : { id, settings };
    running.postMessage(request, font ? [font.bytes] : []);
  });
}

function start(): Worker {
  const started = new Worker(new URL("../workers/text.worker.ts", import.meta.url), {
    type: "module",
  });
  started.onmessage = ({ data }: MessageEvent<TextLayoutResponse>) => {
    const request = waiting.get(data.id);
    waiting.delete(data.id);
    if ("paths" in data) return request?.resolve(data.paths);
    // Its uploaded font may not have reached the worker: send it again next time.
    if (request) sent.delete(request.font);
    request?.reject(new TextLayoutError(data.error));
  };
  // A worker that fails to load fails every request; the next one starts another.
  started.onerror = (event) => {
    event.preventDefault();
    started.terminate();
    worker = null;
    sent.clear();
    for (const request of waiting.values()) request.reject(new TextLayoutError(TEXT_LAYOUT_FAILED));
    waiting.clear();
  };
  worker = started;
  return started;
}
