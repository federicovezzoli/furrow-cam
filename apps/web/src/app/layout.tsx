import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import { PageViewAnalytics } from "@/components/page-view-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { env } from "@/env";
import { themeColors } from "@/lib/theme-colors";
import "./globals.css";

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Furrow CAM",
  description: "Open source, web-based 2.5D CAM for CNC routers.",
};

// Follows the system setting; ThemeProvider overrides it once the app theme is known.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: themeColors.light },
    { media: "(prefers-color-scheme: dark)", color: themeColors.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jetBrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
        {env.NEXT_PUBLIC_GOATCOUNTER_URL && (
          // Reads the current route, which is request data on dynamic pages.
          <Suspense>
            <PageViewAnalytics endpoint={env.NEXT_PUBLIC_GOATCOUNTER_URL} />
          </Suspense>
        )}
      </body>
    </html>
  );
}
