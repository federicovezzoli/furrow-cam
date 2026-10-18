"use client";

import type { Operation } from "@furrow/document";
import { ToolDialog } from "@/features/tools/components/tool-dialog";
import { ToolForm } from "@/features/tools/components/tool-form";
import { nextToolColor } from "@/features/tools/lib/colors";
import type { SavedTool } from "@/features/tools/server";
import { useWorkspaceHost } from "@/features/workspace/providers/workspace-host";
import { newBitType, useAddTool, useToolLibrary } from "./tool-library";

/**
 * Creates a library bit in a modal, without leaving the workspace, starting
 * as the bit type that suits `operation`. Saving adds it to the library at
 * once, until the workspace host has the library again, and hands it to `onSaved`.
 */
export function NewBitDialog({
  operation,
  open,
  onClose,
  onSaved,
}: {
  operation: Operation;
  open: boolean;
  onClose: () => void;
  onSaved: (saved: SavedTool) => void;
}) {
  const { library } = useWorkspaceHost();
  const tools = useToolLibrary();
  const addTool = useAddTool();

  function save(saved: SavedTool) {
    // Applied at once so the select shows the bit before the host has the
    // library again (e.g. whether it became the default).
    addTool({ id: saved.id, isDefault: false, tool: saved.tool });
    onSaved(saved);
  }

  return (
    <ToolDialog
      open={open}
      onClose={onClose}
      title="New bit"
      description="Adds a bit to your library and picks it for this operation."
    >
      {open && (
        <ToolForm
          id={null}
          values={{
            type: newBitType(operation.type),
            color: nextToolColor(tools.map((choice) => choice.tool)),
          }}
          save={library.saveTool}
          onSaved={save}
          onCancel={onClose}
        />
      )}
    </ToolDialog>
  );
}
