/**
 * The one Node global the workspace reads: bundlers (Next.js, Vite) replace
 * `process.env.NODE_ENV` at build time, so the package needs no Node types.
 */
declare const process: { env: { NODE_ENV?: string } };

/** Test fixtures: Vite inlines a font as a data URL, which `fetch` reads. */
declare module "*.ttf?inline" {
  const dataUrl: string;
  export default dataUrl;
}
declare module "*.wasm?url&inline" {
  const dataUrl: string;
  export default dataUrl;
}
declare module "*.step?raw" {
  const text: string;
  export default text;
}
