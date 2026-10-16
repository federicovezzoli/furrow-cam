"use client";

import type { Operation } from "@furrow/document";
import { useRouter } from "next/navigation";
import type { SavedTool } from "@/features/tools/actions";
import { ToolDialog } from "@/features/tools/components/tool-dialog";
import { ToolForm } from "@/features/tools/components/tool-form";
import { nextToolColor } from "@/features/tools/lib/colors";
import { newBitType, useAddTool, useToolLibrary } from "./tool-library";

/**
 * Creates a library bit in a modal, without leaving the workspace, starting
 * as the bit type that suits `operation`. Saving adds it to the library at
 * once, then refreshes it from the server, and hands it to `onSaved`.
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
  const router = useRouter();
  const tools = useToolLibrary();
  const addTool = useAddTool();

  function save(saved: SavedTool) {
    // Applied at once so the select shows the bit before the refresh brings
    // the library as the server has it (e.g. whether it became the default).
    addTool({ id: saved.id, isDefault: false, tool: saved.tool });
    router.refresh();
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
          onSaved={save}
          onCancel={onClose}
        />
      )}
    </ToolDialog>
  );
}
