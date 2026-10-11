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
    function start() {
      const started = new Worker(new URL("../workers/toolpath.worker.ts", import.meta.url), {
        type: "module",
      });
      started.onmessage = ({ data }: MessageEvent<ToolpathResponse>) => schedule.receive(data);
      // Without these, a worker that fails to load or crashes would leave
      // every operation computing forever.
      started.onerror = (event) => {
        event.preventDefault();
        restart(event.message || "The toolpath worker stopped");
      };
      started.onmessageerror = () => restart("A toolpath couldn't be read from the worker");
      return started;
    }

    /** Fails the pending toolpaths and replaces the worker; editing an operation retries it. */
    function restart(error: string) {
      worker.terminate();
      schedule.fail(error);
      worker = start();
    }

    let worker = start();
    const schedule = scheduleToolpaths(documents, toolpaths, (request) =>
      worker.postMessage(request),
    );
    return () => {
      schedule.stop();
      worker.terminate();
      // Requests in flight die with the worker, so nothing may stay computing.
      toolpaths.getState().retain([]);
    };
  }, [documents, toolpaths]);
}
