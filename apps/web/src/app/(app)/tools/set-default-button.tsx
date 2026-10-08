"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setDefaultTool } from "./actions";

export function SetDefaultButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => startTransition(() => setDefaultTool(id))}
      disabled={pending}
    >
      {pending ? "Saving…" : "Set as default"}
    </Button>
  );
}
