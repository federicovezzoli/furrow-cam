import { type Toolpath, type ToolpathInput, toolpathKey } from "@furrow/cam-core";
import type { ProjectDocument } from "@furrow/document";
import { type GcodeExport, postToolpaths } from "@furrow/post";

/** An enabled operation's inputs, as the toolpath scheduler hashed them. */
export type ExportInput = { operationId: string; inputHash: string; input: ToolpathInput };

/**
 * The latest toolpath the toolpath worker computed for each operation, with
 * the hash of the inputs it was computed from (#133), so exporting G-code
 * posts them instead of computing them again. Toolpaths stay derived data in
 * memory (ADR-0004): one per operation, dropped when the operation is
 * disabled or deleted (`retain`).
 */
export class ToolpathResults {
  private readonly results = new Map<
    string,
    { inputHash: string; key: string; toolpath: Toolpath }
  >();
  /** The operations last retained, or `null` before the first `retain`. */
  private retained: Set<string> | null = null;

  /**
   * Keeps `toolpath` as the operation's latest, replacing the one before,
   * unless the operation was left out of the last `retain`: an export queued
   * before it was disabled or deleted mustn't bring it back.
   */
  keep(operationId: string, inputHash: string, key: string, toolpath: Toolpath) {
    if (this.retained && !this.retained.has(operationId)) return;
    this.results.set(operationId, { inputHash, key, toolpath });
  }

  /** The operation's toolpath if it was computed from inputs with `inputHash`. */
  get(operationId: string, inputHash: string): Toolpath | undefined {
    const result = this.results.get(operationId);
    return result?.inputHash === inputHash ? result.toolpath : undefined;
  }

  /**
   * The operation's toolpath if it was computed from inputs with `toolpathKey`
   * `key`, whatever the pins it was checked against (#395).
   */
  computed(operationId: string, key: string): Toolpath | undefined {
    const result = this.results.get(operationId);
    return result?.key === key ? result.toolpath : undefined;
  }

  /** Drops the toolpaths of operations other than `operationIds`, and keeps no others from now on. */
  retain(operationIds: Iterable<string>) {
    this.retained = new Set(operationIds);
    for (const id of this.results.keys()) if (!this.retained.has(id)) this.results.delete(id);
  }

  get size(): number {
    return this.results.size;
  }
}

/**
 * The G-code of `document` from the enabled operations' `inputs`, in order:
 * each toolpath from `results` when it was computed from the same inputs,
 * otherwise from `compute` (and kept), so an operation changed since is
 * never exported stale. The program is the one `exportGcode` gives.
 */
export function exportFromResults(
  document: ProjectDocument,
  name: string,
  inputs: readonly ExportInput[],
  results: ToolpathResults,
  compute: (input: ToolpathInput) => Toolpath,
): GcodeExport {
  const computed = inputs.map(({ operationId, inputHash, input }) => {
    let toolpath = results.get(operationId, inputHash);
    if (!toolpath) {
      toolpath = compute(input);
      results.keep(operationId, inputHash, toolpathKey(input), toolpath);
    }
    return { input, toolpath };
  });
  return postToolpaths(document, name, computed);
}
