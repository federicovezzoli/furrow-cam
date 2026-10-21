"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { cn } from "@furrow/ui/lib/utils";
import { FilmIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { useWorkspaceHost } from "../providers/workspace-host";

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
  const t = useTranslations("Shell");
  const { Link } = useWorkspaceHost().navigation;
  if (disabledReason !== undefined) {
    // A disabled button gets no pointer events, so its wrapper shows why.
    return (
      <span title={disabledReason} className={cn("inline-flex", className)}>
        <Button variant="outline" size="compact" disabled className="w-full">
          <FilmIcon />
          {t("simulate")}
        </Button>
      </span>
    );
  }
  return (
    <Button variant="outline" size="compact" asChild className={className}>
      <Link to="simulator" title={t("simulateTitle")}>
        <FilmIcon />
        {t("simulate")}
      </Link>
    </Button>
  );
}
