"use client";

import type { Tool } from "@furrow/document";
import { PencilIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { ToolDialog } from "@/features/tools/components/tool-dialog";
import { ToolForm } from "@/features/tools/components/tool-form";
import type { ToolChoice } from "@/features/tools/server";
import { useDocumentStoreApi } from "@/features/workspace/providers/workspace-stores";
import {
  type RejectedOperation,
  replaceToolSnapshots,
} from "@/features/workspace/stores/operation-actions";
import { useUpdateTool } from "./tool-library";

/**
 * Edits the library bit `choice` in a modal, without leaving the workspace.
 * Saving also re-snapshots it into every operation of this project that used
 * it (ADR-0003); disabled when the operation's tool matches no library bit.
 */
export function EditBitButton({ choice }: { choice: ToolChoice | undefined }) {
  const store = useDocumentStoreApi();
  const router = useRouter();
  const updateTool = useUpdateTool();
  // Kept while open: once saved, the operation may no longer match a library bit.
  const [editing, setEditing] = useState<ToolChoice | null>(null);
  const [rejected, setRejected] = useState<RejectedOperation[] | null>(null);

  function close() {
    setEditing(null);
    setRejected(null);
  }

  function onSaved(tool: Tool) {
    if (!editing) return;
    // Applied at once so the re-snapshotted operations keep matching it; the
    // refresh then brings the library as the server has it (e.g. by name).
    updateTool(editing.id, tool);
    router.refresh();
    const left = replaceToolSnapshots(store, editing.tool, tool);
    if (left.length > 0) setRejected(left);
    else close();
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon-compact"
        disabled={!choice}
        onClick={() => choice && setEditing(choice)}
        aria-label="Edit bit"
        title="Edit bit"
      >
        <PencilIcon />
      </Button>
      <ToolDialog
        open={editing !== null}
        onClose={close}
        title="Edit bit"
        description="Changes the bit in your library and in every operation of this project that uses it."
      >
        {rejected ? (
          <NotUpdated operations={rejected} onClose={close} />
        ) : (
          editing && (
            <ToolForm id={editing.id} values={editing.tool} onSaved={onSaved} onCancel={close} />
          )
        )}
      </ToolDialog>
    </>
  );
}

/** Shown after saving when some operations couldn't take the edited bit. */
function NotUpdated({
  operations,
  onClose,
}: {
  operations: RejectedOperation[];
  onClose: () => void;
}) {
  return (
    <>
      <div role="alert" className="grid gap-2 text-sm">
        <p>The bit was saved, but these operations keep the bit as it was:</p>
        <ul className="list-disc pl-5">
          {operations.map((operation) => (
            <li key={operation.id}>
              <span className="font-medium">{operation.name}</span>: {operation.error}
            </li>
          ))}
        </ul>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}
