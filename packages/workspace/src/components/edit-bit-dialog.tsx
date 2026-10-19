"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { DialogFooter } from "@furrow/ui/components/ui/dialog";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import type { SavedTool, ToolChoice } from "../lib/workspace-host";
import { useWorkspaceHost } from "../providers/workspace-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import { type RejectedOperation, replaceToolSnapshots } from "../stores/operation-actions";
import { ToolDialog } from "../tools/components/tool-dialog";
import { ToolForm } from "../tools/components/tool-form";
import { useAddTool, useUpdateTool } from "./tool-library";

/**
 * Edits the library bit `choice` in a modal, without leaving the workspace.
 * Saving also re-snapshots it into every operation of this project that used
 * it (ADR-0003); disabled when the operation's tool matches no library bit.
 * A catalog bit can't change (PRD-0008 G5): editing it saves a copy to the
 * library, which those operations then use.
 */
export function EditBitButton({ choice }: { choice: ToolChoice | undefined }) {
  const store = useDocumentStoreApi();
  const { library } = useWorkspaceHost();
  const updateTool = useUpdateTool();
  const addTool = useAddTool();
  // Kept while open: once saved, the operation may no longer match a library bit.
  const [editing, setEditing] = useState<ToolChoice | null>(null);
  const [rejected, setRejected] = useState<RejectedOperation[] | null>(null);

  function close() {
    setEditing(null);
    setRejected(null);
  }

  function onSaved({ id, tool }: SavedTool) {
    if (!editing) return;
    // Applied at once so the re-snapshotted operations keep matching it until
    // the host has the library again (e.g. sorted by name).
    if (editing.catalog) addTool({ id, isDefault: false, tool });
    else updateTool(editing.id, tool);
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
        title={editing?.catalog ? "Save a copy of this bit" : "Edit bit"}
        description={
          editing?.catalog
            ? "Catalog bits stay as they are. This saves your copy to your library and uses it in every operation of this project that uses the catalog bit."
            : "Changes the bit in your library and in every operation of this project that uses it."
        }
      >
        {rejected ? (
          <NotUpdated operations={rejected} onClose={close} />
        ) : (
          editing && (
            <ToolForm
              id={editing.catalog ? null : editing.id}
              values={editing.tool}
              save={library.saveTool}
              onSaved={onSaved}
              onCancel={close}
            />
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
