"use client";

import { lazyWorker } from "@furrow/ui/lib/lazy-worker";
import { useEffect, useState } from "react";
import type { MeshRequest, MeshResponse } from "../lib/mesh-worker-protocol";
import { useWorkspaceHost } from "../providers/workspace-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import { type ModelPreview, scheduleModelPreviews } from "../stores/model-preview-scheduler";

/**
 * The previews of the open project's models, by `previewKey`, drawn in a Web
 * Worker (ADR-0004) while mounted and kept up to date as models are added,
 * turned or removed.
 */
export function useModelPreviews(): ReadonlyMap<string, ModelPreview> {
  const documents = useDocumentStoreApi();
  const meshes = useWorkspaceHost().meshes;
  const [previews, setPreviews] = useState<ReadonlyMap<string, ModelPreview>>(() => new Map());

  useEffect(() => {
    let stopped = false;
    const worker = lazyWorker<MeshRequest, MeshResponse>(
      () => new Worker(new URL("../workers/mesh.worker.ts", import.meta.url), { type: "module" }),
      {
        onMessage: (response) => void schedule.receive(response),
        onFail: (error) => schedule.fail(error),
        failures: {
          stopped: "The model worker stopped",
          unreadable: "A model preview couldn't be read from the worker",
        },
      },
    );
    const schedule = scheduleModelPreviews({
      // A file that finishes loading after unmounting mustn't start the worker again.
      post: (request) => {
        if (!stopped) worker.post(request);
      },
      loadBytes: meshes.get,
      onChange: (next) => {
        if (!stopped) setPreviews(next);
      },
    });
    schedule.update(documents.getState().document.models);
    const unsubscribe = documents.subscribe((state, previous) => {
      if (state.document.models !== previous.document.models) {
        schedule.update(state.document.models);
      }
    });
    return () => {
      stopped = true;
      unsubscribe();
      schedule.stop();
      worker.terminate();
    };
  }, [documents, meshes]);

  return previews;
}
