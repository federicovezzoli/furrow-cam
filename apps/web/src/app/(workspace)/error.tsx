"use client";

import { Button } from "@furrow/ui/components/ui/button";
import Link from "next/link";
import { useTranslations } from "use-intl";
import { ErrorFallback } from "@/components/error-fallback";

export default function WorkspaceError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("Errors");
  return (
    <ErrorFallback {...props} message={t("workspace")} className="mx-auto max-w-2xl">
      <Button variant="outline" asChild>
        <Link href="/projects">{t("allProjects")}</Link>
      </Button>
    </ErrorFallback>
  );
}
