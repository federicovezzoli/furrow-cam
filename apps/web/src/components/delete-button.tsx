"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { Trash2Icon } from "lucide-react";
import { useTransition } from "react";
import type { ActionResult } from "@/lib/form-data";

/** Asks `confirmText` before calling `action`, a server action bound to the item to delete. */
export function DeleteButton({
  name,
  confirmText,
  action,
}: {
  name: string;
  confirmText: string;
  action: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await action();
      if (result) window.alert(result.error);
    });
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
