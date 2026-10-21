import { LocaleProvider } from "@furrow/ui/components/locale-provider";
import type { Locale } from "@furrow/ui/lib/locales";
import { captureUncaughtErrors, setTelemetrySink } from "@furrow/workspace/lib/telemetry";
import { ThemeProvider } from "next-themes";
import type * as React from "react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { App } from "./app";
import "./styles.css";

// The main process sends them only if the user agreed (ADR-0052).
setTelemetrySink({
  track: (event) => api.trackEvent(event),
  error: ({ name, message, stack }) => api.reportError({ name, message, stack }),
});
captureUncaughtErrors(window);

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

/** The interface language from the main process; picking another saves it there (ADR-0054). */
function DesktopLocale({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const [locale, setLocale] = useState(initial);
  return (
    <LocaleProvider
      locale={locale}
      onLocaleChange={(next) => {
        setLocale(next);
        document.documentElement.lang = next;
        void api.setLocale(next);
      }}
    >
      {children}
    </LocaleProvider>
  );
}

// Rendered once the language is known, so the window never shows English first.
void api.getLocale().then((locale) => {
  document.documentElement.lang = locale;
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <DesktopLocale initial={locale}>
          <App />
        </DesktopLocale>
      </ThemeProvider>
    </StrictMode>,
  );
});
