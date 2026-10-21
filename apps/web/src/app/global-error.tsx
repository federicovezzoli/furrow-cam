"use client";

import { LocaleProvider } from "@furrow/ui/components/locale-provider";
import { useIsClient } from "@furrow/ui/hooks/use-is-client";
import { translator } from "@furrow/ui/lib/i18n";
import { posthogHost } from "@furrow/workspace/lib/telemetry";
import { ErrorFallback } from "@/components/error-fallback";
import { Telemetry } from "@/components/telemetry";
import { browserLocale } from "@/lib/locale-cookie";
import "./globals.css";

/** Replaces the root layout when it fails, and reports the error (ADR-0052). */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // The root layout and its language are gone: read it again from the browser,
  // once hydrated, since the server rendered this in English.
  const locale = useIsClient() ? browserLocale() : "en";
  const t = translator(locale);
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>{t("Errors.globalTitle")}</title>
        <LocaleProvider locale={locale} onLocaleChange={() => {}}>
          <ErrorFallback {...props} message={t("Errors.global")} />
        </LocaleProvider>
        {/* The root layout and its telemetry are gone, or never loaded: start it here. */}
        {process.env.NEXT_PUBLIC_POSTHOG_KEY && (
          <Telemetry
            apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY}
            host={posthogHost(process.env.NEXT_PUBLIC_POSTHOG_HOST)}
          />
        )}
      </body>
    </html>
  );
}
