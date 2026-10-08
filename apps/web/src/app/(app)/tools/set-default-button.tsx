"use client";

import { StarIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setDefaultTool } from "./actions";

/** A filled star marks the default tool; an outlined one makes this tool the default. */
export function SetDefaultButton({
  id,
  name,
  isDefault,
}: {
  id: string;
  name: string;
  isDefault: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (isDefault) {
    return (
      <span className="inline-flex size-8 items-center justify-center" title="Default bit">
        <StarIcon className="size-4 fill-current" aria-label="Default bit" />
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => startTransition(() => setDefaultTool(id))}
      disabled={pending}
      aria-label={`Make ${name} the default bit`}
      title="Set as default"
    >
      <StarIcon className="text-muted-foreground" />
    </Button>
  );
}
