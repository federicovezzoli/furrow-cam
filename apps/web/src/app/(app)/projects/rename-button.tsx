"use client";

import { PencilIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { renameProject } from "./actions";

/** Asks for a new name, then renames the project `id`. */
export function RenameButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    const newName = window.prompt("Rename project", name);
    if (newName === null || newName.trim() === name) return;
    startTransition(async () => {
      const result = await renameProject(id, newName);
      if (result) window.alert(result.error);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      disabled={pending}
      aria-label={`Rename ${name}`}
      title="Rename"
    >
      <PencilIcon />
    </Button>
  );
}
