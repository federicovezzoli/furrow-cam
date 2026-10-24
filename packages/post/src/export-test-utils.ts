import type { GcodeExport } from "./export";

/** The only file of a one-sided project's export, with the export's warnings. */
export function oneFile({ files, warnings }: GcodeExport) {
  if (files.length !== 1) throw new Error(`Expected one file, got ${files.length}`);
  return { ...(files[0] as GcodeExport["files"][number]), warnings };
}
