"use client";

import { DialogsProvider } from "@furrow/ui/components/dialogs";
import { LocaleProvider } from "@furrow/ui/components/locale-provider";
import type { Locale } from "@furrow/ui/lib/locales";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { writeLocaleCookie } from "@/lib/locale-cookie";

/**
 * The request's language for client components, and the dialogs they ask with. Picking another stores it in
 * a cookie and re-renders the server components, keeping client state.
 */
export function WebLocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <LocaleProvider
      locale={locale}
      onLocaleChange={(next) => {
        writeLocaleCookie(next);
        document.documentElement.lang = next;
        router.refresh();
      }}
    >
      <DialogsProvider>{children}</DialogsProvider>
    </LocaleProvider>
  );
}
