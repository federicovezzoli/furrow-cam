"use client";

import { useEffect } from "react";
import { lazyWorker } from "@/lib/lazy-worker";
import type { ToolpathRequest, ToolpathResponse } from "@/stores/toolpath-scheduler";
import { scheduleToolpaths } from "@/stores/toolpath-scheduler";
import { useDocumentStoreApi, useToolpathStoreApi } from "@/stores/workspace-stores";

/**
 * Computes the toolpaths of the open project's enabled operations in a Web
 * Worker (ADR-0004) while mounted, keeping the toolpath store up to date.
 */
export function useToolpaths() {
  const documents = useDocumentStoreApi();
  const toolpaths = useToolpathStoreApi();

  useEffect(() => {
    const worker = lazyWorker<ToolpathRequest, ToolpathResponse>(
      () =>
        new Worker(new URL("../workers/toolpath.worker.ts", import.meta.url), { type: "module" }),
      {
        onMessage: (response) => schedule.receive(response),
        // Without this, a worker that fails to load or crashes would leave
        // every operation computing forever; editing an operation retries it.
        onFail: (error) => schedule.fail(error),
        failures: {
          stopped: "The toolpath worker stopped",
          unreadable: "A toolpath couldn't be read from the worker",
        },
      },
    );
    const schedule = scheduleToolpaths(documents, toolpaths, (request) => worker.post(request));
    return () => {
      schedule.stop();
      worker.terminate();
      // Requests in flight die with the worker, so nothing may stay computing.
      toolpaths.getState().retain([]);
    };
  }, [documents, toolpaths]);
}
