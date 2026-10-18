"use client";

import type { Tool } from "@furrow/document";
import { Button } from "@furrow/ui/components/ui/button";
import { ToolDialog } from "@furrow/workspace/tools/components/tool-dialog";
import { ToolForm } from "@furrow/workspace/tools/components/tool-form";
import type * as React from "react";
import { createContext, useContext, useState } from "react";
import { saveTool } from "@/features/tools/lib/save-tool";

/** The bit the library dialog edits; `id` is `null` for a new bit. */
type Editing = { id: string | null; values: Partial<Tool> };

const OpenToolContext = createContext<(editing: Editing) => void>(() => {});

/**
 * Hosts the library's bit dialog, opened by `OpenToolButton`s anywhere inside.
 * Saving revalidates `/tools`, so the table behind the dialog refreshes on its own.
 */
export function ToolDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept after closing, so the title doesn't change while the dialog animates out.
  const [editing, setEditing] = useState<Editing | null>(null);
  // Bumped on every open, so each one starts a fresh form.
  const [session, setSession] = useState(0);
  const close = () => setOpen(false);

  function openTool(next: Editing) {
    setEditing(next);
    setSession((current) => current + 1);
    setOpen(true);
  }

  const isNew = editing?.id === null;
  return (
    <OpenToolContext value={openTool}>
      {children}
      <ToolDialog
        open={open}
        onClose={close}
        title={isNew ? "New bit" : "Edit bit"}
        description={
          isNew
            ? "Adds a bit to your library, to pick when you create operations."
            : "Projects keep their own copy of this bit, so editing it here doesn't change them."
        }
      >
        {editing && (
          <ToolForm
            key={session}
            id={editing.id}
            values={editing.values}
            save={saveTool}
            onSaved={close}
            onCancel={close}
          />
        )}
      </ToolDialog>
    </OpenToolContext>
  );
}

/** Opens the dialog on the bit `id`, or on a new bit when `id` is `null`. */
export function OpenToolButton({
  id,
  values,
  ...props
}: Editing & Omit<React.ComponentProps<typeof Button>, "id" | "onClick">) {
  const openTool = useContext(OpenToolContext);
  return <Button {...props} onClick={() => openTool({ id, values })} />;
}
