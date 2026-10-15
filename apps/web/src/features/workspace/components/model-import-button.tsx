"use client";

import { FileBoxIcon } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { importModel } from "@/features/workspace/lib/model-import";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useMeshLimits,
  useProjectId,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from "@/features/workspace/providers/workspace-stores";
import { hasImportedFile, ONE_FILE } from "@/features/workspace/stores/geometry-actions";

/** Why STL import is off: the server has no storage for meshes (ADR-0029). */
export const STL_IMPORT_OFF = "STL import isn't available on this server.";

/**
 * Picks an STL file and imports it as a model (PRD-0005 S1): a labelled
 * button, or an icon for the viewport's toolbar. Disabled while another
 * file imports, once the project holds an imported file (one per project for
 * now) and, saying why, when the server can't store meshes.
 */
export function ModelImportButton({ icon = false }: { icon?: boolean }) {
  const document = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const projectId = useProjectId();
  const limits = useMeshLimits();
  const importing = useWorkspaceStore(
    (s) => s.modelImport !== null && s.modelImport.error === null,
  );
  const full = useDocumentStore((s) => hasImportedFile(s.document));
  const input = useRef<HTMLInputElement>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Lets the same file be picked again after fixing it.
    event.currentTarget.value = "";
    if (file && limits) void importModel(file, { projectId, limits, document, workspace });
  }

  const label = "Import STL model…";
  const title = !limits ? STL_IMPORT_OFF : full ? ONE_FILE : label;
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
        variant={icon ? "ghost" : "outline"}
        size={icon ? "icon-compact" : "compact"}
        disabled={!limits || full || importing}
        aria-label={icon ? label : undefined}
        title={title}
        onClick={() => input.current?.click()}
        className={icon ? undefined : "justify-self-start"}
      >
        <FileBoxIcon />
        {!icon && "Import STL…"}
      </Button>
    </>
  );
}
