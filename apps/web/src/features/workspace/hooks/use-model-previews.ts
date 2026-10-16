"use client";

import { useEffect, useState } from "react";
import { loadMesh } from "@/features/workspace/lib/mesh-cache";
import type { MeshRequest, MeshResponse } from "@/features/workspace/lib/mesh-worker-protocol";
import { useDocumentStoreApi, useProjectId } from "@/features/workspace/providers/workspace-stores";
import {
  type ModelPreview,
  scheduleModelPreviews,
} from "@/features/workspace/stores/model-preview-scheduler";
import { lazyWorker } from "@/lib/lazy-worker";

/**
 * The previews of the open project's models, by `previewKey`, drawn in a Web
 * Worker (ADR-0004) while mounted and kept up to date as models are added,
 * turned or removed.
 */
export function useModelPreviews(): ReadonlyMap<string, ModelPreview> {
  const documents = useDocumentStoreApi();
  const projectId = useProjectId();
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
      loadBytes: (sha256) => loadMesh(projectId, sha256),
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
      worker.terminate();
    };
  }, [documents, projectId]);

  return previews;
}
