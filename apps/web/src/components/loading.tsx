"use client";

import { useTranslations } from "use-intl";

/**
 * "Loading…" (or "Loading project…") in the app's language, e.g. a Suspense
 * fallback in a server component.
 */
export function Loading({
  className = "text-muted-foreground",
  project = false,
}: {
  className?: string;
  project?: boolean;
}) {
  const t = useTranslations("Common");
  return <p className={className}>{project ? t("loadingProject") : t("loading")}</p>;
}
