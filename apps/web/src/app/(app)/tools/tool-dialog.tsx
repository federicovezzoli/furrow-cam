"use client";

import type { Tool } from "@furrow/document";
import { PencilIcon } from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToolForm } from "./tool-form";

/**
 * The modal the bit form opens in, in the library and in the workspace. It
 * scrolls instead of overflowing on short or narrow screens.
 */
export function ToolDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The bit the library dialog edits; `id` is `null` for a new bit. */
type Editing = { id: string | null; values: Partial<Tool> };

const OpenToolContext = createContext<(editing: Editing) => void>(() => {});

/**
 * Hosts the library's bit dialog, opened by `NewToolButton`, `EditToolName`
 * and `EditToolButton` anywhere inside. Saving revalidates `/tools`, so the
 * table behind the dialog refreshes on its own.
 */
export function ToolDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Kept after closing, so the title doesn't change while the dialog animates out.
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setOpen(false);

  function openTool(next: Editing) {
    setEditing(next);
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
          <ToolForm id={editing.id} values={editing.values} onSaved={close} onCancel={close} />
        )}
      </ToolDialog>
    </OpenToolContext>
  );
}

/** Opens the dialog on a new bit, in the next palette colour `color`. */
export function NewToolButton({ color }: { color: string }) {
  const openTool = useContext(OpenToolContext);
  return <Button onClick={() => openTool({ id: null, values: { color } })}>New bit</Button>;
}

/** The bit's name in the table, opening it in the dialog. */
export function EditToolName({ id, values }: { id: string; values: Partial<Tool> }) {
  const openTool = useContext(OpenToolContext);
  return (
    <button
      type="button"
      onClick={() => openTool({ id, values })}
      className="cursor-pointer font-medium hover:underline"
    >
      {values.name}
    </button>
  );
}

/** The table's edit button, opening the bit in the dialog. */
export function EditToolButton({ id, values }: { id: string; values: Partial<Tool> }) {
  const openTool = useContext(OpenToolContext);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title="Edit"
      aria-label={`Edit ${values.name}`}
      onClick={() => openTool({ id, values })}
    >
      <PencilIcon />
    </Button>
  );
}
