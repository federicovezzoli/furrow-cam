"use client";

import { Trash2Icon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteTool } from "./actions";

export function DeleteToolButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    // Projects keep their own snapshot of the tool, so deleting it is safe (ADR-0003).
    if (!window.confirm(`Delete "${name}"? Existing projects keep their copy of this bit.`)) return;
    startTransition(() => deleteTool(id));
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={`Delete ${name}`}
      title="Delete"
    >
      <Trash2Icon />
    </Button>
  );
}
