"use client";

import { FileBoxIcon } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { importModel } from "@/features/workspace/lib/model-import";
import {
  useDocumentStoreApi,
  useMeshLimits,
  useProjectId,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";

/** Why STL import is off: the server has no storage for meshes (ADR-0029). */
export const STL_IMPORT_OFF = "STL import isn't available on this server.";

/**
 * Picks an STL file and imports it as a model (PRD-0005 S1), from the empty
 * project's import card. Disabled while a file imports and, saying why, when
 * the server can't store meshes.
 */
export function ModelImportButton() {
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const projectId = useProjectId();
  const limits = useMeshLimits();
  const importing = useWorkspaceStore(
    (s) => s.modelImport !== null && s.modelImport.error === null,
  );
  const input = useRef<HTMLInputElement>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (file && limits) void importModel(file, { projectId, limits, document, workspace });
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".stl,model/stl"
        onChange={onChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
      <Button
        variant="outline"
        size="compact"
        disabled={!limits || importing}
        title={limits ? undefined : STL_IMPORT_OFF}
        onClick={() => input.current?.click()}
        className="justify-self-start"
      >
        <FileBoxIcon />
        Import STL…
      </Button>
    </>
  );
}
