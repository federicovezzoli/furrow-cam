import occtPackage from "occt-import-js/package.json";

/** The installed occt-import-js, which bundles OpenCascade. */
export const OCCT_VERSION = occtPackage.version;

/**
 * The licences of occt-import-js and OpenCascade (LGPL-2.1), shipped beside
 * the WebAssembly as the LGPL asks (ADR-0072).
 */
export const OCCT_LICENCES = [
  { name: "OpenCascade", url: new URL("occt-import-js/dist/license.occt.txt", import.meta.url) },
  {
    name: "occt-import-js",
    url: new URL("occt-import-js/dist/license.occt-import-js.txt", import.meta.url),
  },
];
