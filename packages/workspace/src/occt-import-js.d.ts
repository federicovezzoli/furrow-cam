/** The parts of occt-import-js (OpenCascade compiled to WebAssembly) that STEP import uses. */
declare module "occt-import-js" {
  export type OcctMesh = {
    attributes: { position: { array: number[] } };
    index: { array: number[] };
  };
  export type OcctResult = { success: boolean; meshes?: OcctMesh[] };
  export type Occt = {
    ReadStepFile(
      content: Uint8Array,
      params: {
        linearUnit: "millimeter";
        linearDeflectionType: "absolute_value";
        linearDeflection: number;
        angularDeflection: number;
      } | null,
    ): OcctResult;
  };
  /** Loads the module; `wasmBinary` spares it fetching or reading the WebAssembly itself. */
  export default function occtimportjs(options: {
    wasmBinary: ArrayBuffer | Uint8Array;
  }): Promise<Occt>;
}
