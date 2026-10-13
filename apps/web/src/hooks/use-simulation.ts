"use client";

import type { Heightmap } from "@furrow/cam-core";
import { useEffect, useState } from "react";
import { deviceHeightmapCellLimit } from "@/lib/simulation-mesh";
import { type SimulationResponse, scheduleSimulation } from "@/stores/simulation-scheduler";
import { useDocumentStoreApi, useToolpathStoreApi } from "@/stores/workspace-stores";

/**
 * The open project's stock as simulated after cutting (ADR-0019), from the
 * toolpaths of its enabled operations, computed in a Web Worker while
 * `enabled` (ADR-0004) and redone whenever they change. Derived data: it lives
 * here, never in the document. While a new simulation runs, `heightmap` keeps
 * the last one and `pending` is true.
 */
export function useSimulation(enabled: boolean) {
  const documents = useDocumentStoreApi();
  const toolpaths = useToolpathStoreApi();
  const [result, setResult] = useState<{ heightmap: Heightmap | null; error: string | null }>({
    heightmap: null,
    error: null,
  });
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [receivedKey, setReceivedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function start() {
      const started = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
        type: "module",
      });
      started.onmessage = ({ data }: MessageEvent<SimulationResponse>) => schedule.receive(data);
      started.onerror = (event) => {
        event.preventDefault();
        restart(event.message || "The simulation worker stopped");
      };
      started.onmessageerror = () => restart("The simulation couldn't be read from the worker");
      return started;
    }

    function restart(error: string) {
      worker.terminate();
      schedule.fail(error);
      worker = start();
    }

    let worker = start();
    const schedule = scheduleSimulation(
      documents,
      toolpaths,
      (request) => {
        setSentKey(request.key);
        worker.postMessage(request);
      },
      (response) => {
        setReceivedKey(response.key);
        setResult((last) =>
          "error" in response
            ? { heightmap: last.heightmap, error: response.error }
            : { heightmap: response.heightmap, error: null },
        );
      },
      deviceHeightmapCellLimit(),
    );
    return () => {
      schedule.stop();
      worker.terminate();
      /** Turned on again, it simulates afresh rather than showing an old stock. */
      setResult({ heightmap: null, error: null });
      setSentKey(null);
      setReceivedKey(null);
    };
  }, [enabled, documents, toolpaths]);

  return { ...result, pending: enabled && (sentKey === null || sentKey !== receivedKey) };
}
