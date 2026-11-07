import { posthogHost } from "@furrow/workspace/lib/telemetry";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import type * as React from "react";
import { Suspense } from "react";
import { Telemetry } from "@/components/telemetry";
import { ThemeProvider } from "@/components/theme-provider";
import { WebLocaleProvider } from "@/components/web-locale-provider";
import { env } from "@/env";
import { getLocale, getTranslator } from "@/lib/locale";
import { themeColors } from "@/lib/theme-colors";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: "Furrow CAM", description: t("Meta.description") };
}

// Follows the system setting; ThemeProvider overrides it once the app theme is known.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: themeColors.light },
    { media: "(prefers-color-scheme: dark)", color: themeColors.dark },
  ],
};

/**
 * `lang` is set by `LocalizedApp`: the language comes from the request, which
 * would make the whole document request-bound if read here (ADR-0054).
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jetBrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {/* No fallback: pages stream in the request's language, never English first. */}
          <Suspense>
            <LocalizedApp>{children}</LocalizedApp>
          </Suspense>
        </ThemeProvider>
        {env.NEXT_PUBLIC_POSTHOG_KEY && (
          // Reads the current route, which is request data on dynamic pages.
          <Suspense>
            <Telemetry
              apiKey={env.NEXT_PUBLIC_POSTHOG_KEY}
              host={posthogHost(env.NEXT_PUBLIC_POSTHOG_HOST)}
            />
          </Suspense>
        )}
      </body>
    </html>
  );
}

/** The app in the request's language, with `<html lang>` set to match before it paints. */
async function LocalizedApp({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <>
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed statement; `locale` is one of `LOCALES`.
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.lang=${JSON.stringify(locale)}`,
        }}
      />
      <WebLocaleProvider locale={locale}>{children}</WebLocaleProvider>
    </>
  );
}
