"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/features/workspace/stores/operation-actions";

/**
 * A text input that renames on Enter or blur; Escape, or a rejected name,
 * restores the current one. `onDone` is called after either.
 */
export function OperationNameInput({
  id,
  name,
  onRename,
  onDone,
  autoFocus,
  className,
  ...props
}: {
  id?: string;
  name: string;
  onRename: (name: string) => ActionResult;
  onDone?: () => void;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  /** What's typed while editing; `null` shows the current name. */
  const [draft, setDraft] = useState<string | null>(null);

  function finish(commit: boolean) {
    if (commit && draft !== null && draft !== name) onRename(draft);
    setDraft(null);
    onDone?.();
  }

  return (
    <Input
      id={id}
      value={draft ?? name}
      autoFocus={autoFocus}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      className={className ?? "h-control px-2 text-ui md:text-ui"}
      {...props}
    />
  );
}
