"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteTool } from "./actions";

export function DeleteToolButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    // Projects keep their own snapshot of the tool, so deleting it is safe (ADR-0003).
    if (!window.confirm(`Delete "${name}"? Existing projects keep their copy of this tool.`))
      return;
    startTransition(() => deleteTool(id));
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
