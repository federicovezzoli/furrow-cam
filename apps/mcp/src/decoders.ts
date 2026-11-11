import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/** Decoded pixels, RGBA row by row from the top. */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type ImageFormat = "webp" | "png" | "jpeg";
type Decode = (bytes: ArrayBuffer) => Promise<Pixels>;

/** Each format's decoder and its WebAssembly, kept out of the bundle (Node has no `createImageBitmap`). */
const CODECS: Record<
  ImageFormat,
  () => Promise<{ init: (wasm: WebAssembly.Module) => unknown; decode: Decode; wasm: string }>
> = {
  webp: async () => {
    const { default: decode, init } = await import("@jsquash/webp/decode.js");
    return { decode, init, wasm: "@jsquash/webp/codec/dec/webp_dec.wasm" };
  },
  png: async () => {
    const { default: decode, init } = await import("@jsquash/png/decode.js");
    return {
      decode: (bytes) => decode(bytes),
      init,
      wasm: "@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
    };
  },
  jpeg: async () => {
    const { default: decode, init } = await import("@jsquash/jpeg/decode.js");
    return {
      decode: (bytes) => decode(bytes),
      init,
      wasm: "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm",
    };
  },
};

const decoders = new Map<ImageFormat, Promise<Decode>>();

/** The decoder for `format`, its WebAssembly read from the package and compiled once. */
export function imageDecoder(format: ImageFormat): Promise<Decode> {
  let decoder = decoders.get(format);
  if (!decoder) {
    decoder = (async () => {
      const { decode, init, wasm } = await CODECS[format]();
      const require = createRequire(import.meta.url);
      await init(await WebAssembly.compile(await readFile(require.resolve(wasm))));
      return decode;
    })();
    // A failed load is tried again on the next call, not kept.
    decoder.catch(() => decoders.delete(format));
    decoders.set(format, decoder);
  }
  return decoder;
}

/** The format of an image file, from its first bytes, or `null` for any other. */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}
