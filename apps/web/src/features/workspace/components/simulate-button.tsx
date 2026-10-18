"use client";

import { FilmIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceHost } from "@/features/workspace/providers/workspace-host";
import { cn } from "@/lib/utils";

/**
 * Opens the project's simulator, which plays the
 * cut back move by move. Disabled while `disabledReason` says why.
 */
export function SimulateButton({
  disabledReason,
  className,
}: {
  disabledReason?: string;
  className?: string;
}) {
  const { Link } = useWorkspaceHost().navigation;
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
      <Link to="simulator" title="Play back the cut move by move">
        <FilmIcon />
        Simulate
      </Link>
    </Button>
  );
}
