"use client";

import type { Tool } from "@furrow/document";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { ToolForm } from "@/app/(app)/tools/tool-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ToolChoice } from "@/lib/tools";
import { type RejectedOperation, replaceToolSnapshots } from "@/stores/operation-actions";
import { useDocumentStoreApi } from "@/stores/workspace-stores";
import { useUpdateTool } from "./tool-library";

/**
 * Edits the library bit `choice` in a modal, without leaving the workspace.
 * Saving also re-snapshots it into every operation of this project that used
 * it (ADR-0003); disabled when the operation's tool matches no library bit.
 */
export function EditBitButton({ choice }: { choice: ToolChoice | undefined }) {
  const store = useDocumentStoreApi();
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
    updateTool(editing.id, tool);
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
      <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit bit</DialogTitle>
            <DialogDescription>
              Changes the bit in your library and in every operation of this project that uses it.
            </DialogDescription>
          </DialogHeader>
          {rejected ? (
            <NotUpdated operations={rejected} onClose={close} />
          ) : (
            editing && (
              <ToolForm id={editing.id} values={editing.tool} onSaved={onSaved} onCancel={close} />
            )
          )}
        </DialogContent>
      </Dialog>
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
