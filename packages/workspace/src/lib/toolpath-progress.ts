import type { Operation } from "@furrow/document";
import type { ToolpathEntry } from "../stores/toolpath-store";

/** What the progress toast shows of a batch of toolpaths computing. */
export type ToolpathProgress = {
  /** The operation the worker computes now, with its progress if it reports it (3D operations). */
  running: { id: string; name: string; progress?: number };
  done: number;
  total: number;
};

/**
 * Summarises the toolpaths computing for the toast. `batch` holds the
 * operations computing since nothing last was; the returned batch adds those
 * computing now and is empty, with no summary, once none is. The worker
 * computes one request at a time, in the order they came (ADR-0004), and
 * only the one it runs reports progress; until one does, the first enabled
 * operation computing stands for it.
 */
export function toolpathProgress(
  operations: readonly Pick<Operation, "id" | "name" | "enabled">[],
  entries: Readonly<Record<string, ToolpathEntry>>,
  batch: ReadonlySet<string>,
): { batch: Set<string>; summary: ToolpathProgress | null } {
  const enabled = operations.filter((operation) => operation.enabled);
  const computing = enabled.filter((operation) => entries[operation.id]?.status === "computing");
  const progressOf = (id: string) => {
    const entry = entries[id];
    return entry?.status === "computing" ? entry.progress : undefined;
  };
  const running =
    computing.find((operation) => progressOf(operation.id) !== undefined) ?? computing[0];
  if (!running) return { batch: new Set(), summary: null };
  const ids = new Set(enabled.map((operation) => operation.id));
  const next = new Set([...batch].filter((id) => ids.has(id)));
  for (const operation of computing) next.add(operation.id);
  const progress = progressOf(running.id);
  return {
    batch: next,
    summary: {
      running: { id: running.id, name: running.name, ...(progress !== undefined && { progress }) },
      done: next.size - computing.length,
      total: next.size,
    },
  };
}
