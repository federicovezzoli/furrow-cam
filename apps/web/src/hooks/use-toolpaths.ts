"use client";

import { useEffect } from "react";
import type { ToolpathResponse } from "@/stores/toolpath-scheduler";
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
    const worker = new Worker(new URL("../workers/toolpath.worker.ts", import.meta.url), {
      type: "module",
    });
    const schedule = scheduleToolpaths(documents, toolpaths, (request) =>
      worker.postMessage(request),
    );
    worker.onmessage = ({ data }: MessageEvent<ToolpathResponse>) => schedule.receive(data);
    return () => {
      schedule.stop();
      worker.terminate();
      // Requests in flight die with the worker, so nothing may stay computing.
      toolpaths.getState().retain([]);
    };
  }, [documents, toolpaths]);
}
