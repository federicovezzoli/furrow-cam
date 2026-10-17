"use client";

import { FilmIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Opens the project's simulator (`/projects/[id]/simulate`), which plays the
 * cut back move by move. Disabled while `disabledReason` says why.
 */
export function SimulateButton({
  projectId,
  disabledReason,
  className,
}: {
  projectId: string;
  disabledReason?: string;
  className?: string;
}) {
  if (disabledReason !== undefined) {
    // A disabled button gets no pointer events, so its wrapper shows why.
    return (
      <span title={disabledReason} className={cn("inline-flex", className)}>
        <Button variant="outline" size="compact" disabled className="w-full">
          <FilmIcon />
          Simulate
        </Button>
      </span>
    );
  }
  return (
    <Button variant="outline" size="compact" asChild className={className}>
      <Link href={`/projects/${projectId}/simulate`} title="Play back the cut move by move">
        <FilmIcon />
        Simulate
      </Link>
    </Button>
  );
}
