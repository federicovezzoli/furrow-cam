"use client";

import { Button } from "@furrow/ui/components/ui/button";
import Link from "next/link";
import posthog from "posthog-js/no-external";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { USAGE_SETTINGS_EVENT } from "@/lib/telemetry";

/**
 * Asks whether to send detailed usage statistics (ADR-0093): once, without
 * blocking the page, and again whenever the footer or the account menu opens
 * it. PostHog keeps the answer.
 */
export function UsageConsent({ onChange }: { onChange: (agreed: boolean) => void }) {
  const t = useTranslations("UsageConsent");
  const [status, setStatus] = useState<"granted" | "denied" | "pending" | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const current = posthog.get_explicit_consent_status();
    setStatus(current);
    setOpen(current === "pending");
    const reopen = () => {
      setStatus(posthog.get_explicit_consent_status());
      setOpen(true);
    };
    window.addEventListener(USAGE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(USAGE_SETTINGS_EVENT, reopen);
  }, []);

  if (!open) return null;

  function answer(agreed: boolean) {
    onChange(agreed);
    setStatus(agreed ? "granted" : "denied");
    setOpen(false);
  }

  return (
    <section
      aria-labelledby="usage-consent-title"
      className="fixed right-4 bottom-4 left-4 z-50 grid gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg sm:left-auto sm:w-96"
    >
      <h2 id="usage-consent-title" className="font-medium">
        {t("title")}
      </h2>
      <p className="text-muted-foreground">
        {t("body")}{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          {t("privacy")}
        </Link>
      </p>
      {status !== "pending" && (
        <p className="text-muted-foreground">
          {status === "granted" ? t("currentlyAllowed") : t("currentlyDeclined")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => answer(false)}>
          {t("decline")}
        </Button>
        <Button size="sm" onClick={() => answer(true)}>
          {t("allow")}
        </Button>
      </div>
    </section>
  );
}
