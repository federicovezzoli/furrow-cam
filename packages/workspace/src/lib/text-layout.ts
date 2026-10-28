import { type Message, MessageError, type Path, Sha256, type TextSettings } from "@furrow/document";

/** An uploaded font's file and whether it is single-stroke (ADR-0062). */
export type UploadedFontFile = { bytes: ArrayBuffer; singleStroke: boolean };

/**
 * The project's uploaded fonts: whether one is single-stroke, as the document
 * says now, or `undefined` if it isn't listed, and its file, which `read`
 * throws if it can't read.
 */
export type UploadedFonts = {
  singleStroke(sha256: string): boolean | undefined;
  read(sha256: string): Promise<ArrayBuffer>;
};

/**
 * What the text worker is asked, `id` pairing the answer with it: to lay a
 * text item's settings out, with the uploaded font they use when the worker
 * may not hold it, or to check an uploaded font and keep it for layouts.
 */
export type TextWorkerRequest =
  | { kind: "layout"; id: number; settings: TextSettings; font?: UploadedFontFile }
  | { kind: "inspect"; id: number; sha256: string; font: UploadedFontFile };

/**
 * The outlines in stock coordinates, a checked font's name, `missing` when a
 * layout's uploaded font isn't in the worker (it was never sent, or dropped),
 * or why it failed, for the user.
 */
export type TextWorkerResponse =
  | { id: number; paths: Path[] }
  | { id: number; name: string }
  | { id: number; missing: true }
  | { id: number; error: Message };

/** Why a text item or font couldn't be laid out or read, for the user (ADR-0054). */
export class TextLayoutError extends MessageError {}

/** Why an uploaded font couldn't be loaded, e.g. downloading it failed. */
export const FONT_UNAVAILABLE: Message = { code: "workspace.fontUnavailable" };

/** Why text can't use an uploaded font the project no longer lists, e.g. its upload undone. */
export const FONT_REMOVED: Message = { code: "workspace.fontRemoved" };

/** Why text couldn't be laid out, when nothing more precise is known. */
export const TEXT_LAYOUT_FAILED: Message = { code: "workspace.textLayoutFailed" };

let worker: Worker | null = null;
const waiting = new Map<number, (response: TextWorkerResponse) => void>();
let nextId = 0;
/**
 * The uploaded fonts sent to the running worker, by hash, with the
 * single-stroke flag sent. The worker may since have dropped one; it then
 * answers `missing`, and the font is sent again.
 */
const sent = new Map<string, boolean>();

/**
 * Text item `settings`' outlines in stock coordinates (`textPaths`), laid
 * out in a Web Worker (ADR-0004) that stays for the next edit, with the fonts
 * it loaded. An uploaded font is read through `uploaded` and sent when the
 * worker doesn't hold it as the project now has it: the first time, when its
 * single-stroke flag changed, or when the worker says it's missing. Throws a
 * `TextLayoutError` if the text can't be laid out.
 */
export async function layoutText(
  settings: TextSettings,
  uploaded?: UploadedFonts,
): Promise<Path[]> {
  const sha256 = Sha256.safeParse(settings.font).success ? settings.font : null;
  for (let attempt = 0; ; attempt++) {
    const font = sha256 ? await fontToSend(sha256, uploaded, attempt > 0) : undefined;
    const response = await post({ kind: "layout", id: nextId++, settings, ...(font && { font }) });
    if ("paths" in response) return response.paths;
    if (sha256) sent.delete(sha256);
    // Missing again right after it was sent can't be fixed by sending it again.
    if ("missing" in response && attempt === 0) continue;
    throw new TextLayoutError("error" in response ? response.error : TEXT_LAYOUT_FAILED);
  }
}

/**
 * Has the worker check `bytes`, the uploaded font `sha256`, and keep it for
 * layouts, so it isn't sent again; returns the name it gives (`fontName`).
 * Throws a `TextLayoutError` if it isn't a font the worker can read. The
 * bytes go to the worker.
 */
export async function inspectFont(
  sha256: string,
  bytes: ArrayBuffer,
  singleStroke: boolean,
): Promise<string> {
  sent.set(sha256, singleStroke);
  const response = await post({
    kind: "inspect",
    id: nextId++,
    sha256,
    font: { bytes, singleStroke },
  });
  if ("name" in response) return response.name;
  sent.delete(sha256);
  throw new TextLayoutError("error" in response ? response.error : TEXT_LAYOUT_FAILED);
}

/**
 * The uploaded font `sha256` to send with a layout, or nothing when the worker
 * holds it as the project has it and `resend` isn't asked.
 */
async function fontToSend(
  sha256: string,
  uploaded: UploadedFonts | undefined,
  resend: boolean,
): Promise<UploadedFontFile | undefined> {
  const singleStroke = uploaded?.singleStroke(sha256);
  if (!uploaded || singleStroke === undefined) throw new TextLayoutError(FONT_REMOVED);
  if (!resend && sent.get(sha256) === singleStroke) return undefined;
  let bytes: ArrayBuffer;
  try {
    bytes = await uploaded.read(sha256);
  } catch (error) {
    console.error(error);
    throw new TextLayoutError(FONT_UNAVAILABLE);
  }
  sent.set(sha256, singleStroke);
  return { bytes, singleStroke };
}

function post(request: TextWorkerRequest): Promise<TextWorkerResponse> {
  const running = worker ?? start();
  return new Promise((resolve) => {
    waiting.set(request.id, resolve);
    running.postMessage(request, request.font ? [request.font.bytes] : []);
  });
}

function start(): Worker {
  const started = new Worker(new URL("../workers/text.worker.ts", import.meta.url), {
    type: "module",
  });
  started.onmessage = ({ data }: MessageEvent<TextWorkerResponse>) => {
    const answer = waiting.get(data.id);
    waiting.delete(data.id);
    answer?.(data);
  };
  // A worker that fails to load fails every request; the next one starts another.
  started.onerror = (event) => {
    event.preventDefault();
    started.terminate();
    worker = null;
    sent.clear();
    for (const [id, answer] of waiting) answer({ id, error: TEXT_LAYOUT_FAILED });
    waiting.clear();
  };
  worker = started;
  return started;
}
