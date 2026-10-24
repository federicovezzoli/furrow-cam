import { type Message, MessageError, type Path, type TextSettings } from "@furrow/document";

/** A text item's settings to lay out, `id` pairing the answer with it. */
export type TextLayoutRequest = { id: number; settings: TextSettings };

/** Its outlines in stock coordinates, or why there are none, for the user. */
export type TextLayoutResponse = { id: number; paths: Path[] } | { id: number; error: Message };

/** Why a text item couldn't be laid out, for the user (ADR-0054). */
export class TextLayoutError extends MessageError {}

/** Why text couldn't be laid out, when nothing more precise is known. */
export const TEXT_LAYOUT_FAILED: Message = { code: "workspace.textLayoutFailed" };

let worker: Worker | null = null;
const waiting = new Map<
  number,
  { resolve: (paths: Path[]) => void; reject: (error: Error) => void }
>();
let nextId = 0;

/**
 * Text item `settings`' outlines in stock coordinates (`textPaths`), laid
 * out in a Web Worker (ADR-0004) that stays for the next edit, with the fonts
 * it loaded. Throws a `TextLayoutError` if they can't be.
 */
export function layoutText(settings: TextSettings): Promise<Path[]> {
  const running = worker ?? start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    running.postMessage({ id, settings } satisfies TextLayoutRequest);
  });
}

function start(): Worker {
  const started = new Worker(new URL("../workers/text.worker.ts", import.meta.url), {
    type: "module",
  });
  started.onmessage = ({ data }: MessageEvent<TextLayoutResponse>) => {
    const request = waiting.get(data.id);
    waiting.delete(data.id);
    if ("paths" in data) request?.resolve(data.paths);
    else request?.reject(new TextLayoutError(data.error));
  };
  // A worker that fails to load fails every request; the next one starts another.
  started.onerror = (event) => {
    event.preventDefault();
    started.terminate();
    worker = null;
    for (const request of waiting.values()) request.reject(new TextLayoutError(TEXT_LAYOUT_FAILED));
    waiting.clear();
  };
  worker = started;
  return started;
}
