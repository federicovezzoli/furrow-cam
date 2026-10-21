"use client";

import { useTranslations } from "use-intl";
import { ErrorFallback } from "@/components/error-fallback";

export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("Errors");
  return (
    <ErrorFallback {...props} message={t("app")} className="mx-auto max-w-screen-2xl flex-1" />
  );
}
