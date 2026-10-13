"use client";

import type { Heightmap } from "@furrow/cam-core";
import { useEffect, useMemo, useState } from "react";
import { lazyWorker } from "@/lib/lazy-worker";
import {
  type SimulationInput,
  type SimulationRequest,
  type SimulationResponse,
  scheduleSimulation,
} from "@/stores/simulation-scheduler";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useToolpathStore,
  useToolpathStoreApi,
} from "@/stores/workspace-stores";

type Result = {
  heightmap: Heightmap | null;
  /** The stock `heightmap` was simulated on, which may differ from the current one. */
  stock: SimulationInput["stock"] | null;
  error: string | null;
};

const EMPTY: Result = { heightmap: null, stock: null, error: null };

/**
 * The open project's stock as simulated after cutting (ADR-0019), from the
 * toolpaths of its enabled operations, computed in a Web Worker while
 * `maxCells` is set (ADR-0004) and redone whenever they change. `maxCells`
 * caps the heightmap at what the viewport's renderer can draw. Derived data:
 * it lives here, never in the document.
 *
 * While toolpaths recompute or a new simulation runs, `heightmap` keeps the
 * last one and `pending` is true. `skipped` names the enabled operations left
 * out because their toolpath failed.
 */
export function useSimulation(maxCells: number | null) {
  const documents = useDocumentStoreApi();
  const toolpaths = useToolpathStoreApi();
  const [result, setResult] = useState<Result>(EMPTY);
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [receivedKey, setReceivedKey] = useState<string | null>(null);
  const operations = useDocumentStore((s) => s.document.operations);
  const entries = useToolpathStore((s) => s.entries);
  const skipped = useMemo(
    () =>
      operations
        .filter((op) => op.enabled && entries[op.id]?.status === "error")
        .map((op) => op.name),
    [operations, entries],
  );
  const computing = useMemo(
    () => Object.values(entries).some((entry) => entry.status === "computing"),
    [entries],
  );

  useEffect(() => {
    if (maxCells === null) return;
    const worker = lazyWorker<SimulationRequest, SimulationResponse>(
      () =>
        new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
          type: "module",
        }),
      {
        onMessage: (response) => schedule.receive(response),
        onFail: (error) => schedule.fail(error),
        failures: {
          stopped: "The simulation worker stopped",
          unreadable: "The simulation couldn't be read from the worker",
        },
      },
    );
    const schedule = scheduleSimulation(
      documents,
      toolpaths,
      (request) => {
        setSentKey(request.key);
        worker.post(request);
      },
      (response) => {
        setReceivedKey(response.key);
        setResult((last) =>
          "error" in response
            ? { ...last, error: response.error }
            : { heightmap: response.heightmap, stock: response.stock, error: null },
        );
      },
      maxCells,
    );
    return () => {
      schedule.stop();
      worker.terminate();
      // Turned on again, it simulates afresh rather than showing an old stock.
      setResult(EMPTY);
      setSentKey(null);
      setReceivedKey(null);
    };
  }, [maxCells, documents, toolpaths]);

  const enabled = maxCells !== null;
  return {
    ...result,
    skipped,
    pending: enabled && (computing || sentKey === null || sentKey !== receivedKey),
  };
}
