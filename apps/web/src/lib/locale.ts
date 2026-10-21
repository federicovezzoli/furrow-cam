import "server-only";
import { translator } from "@furrow/ui/lib/i18n";
import { isLocale, matchLocale, parseAcceptLanguage } from "@furrow/ui/lib/locales";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE } from "./locale-cookie";

/**
 * The request's interface language (ADR-0054): the picked one, else the
 * browser's, else English. Request data: call it inside `<Suspense>`.
 */
export const getLocale = cache(async () => {
  const picked = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(picked)) return picked;
  return matchLocale(parseAcceptLanguage((await headers()).get("accept-language")));
});

/** Translates in server components, in the request's language. */
export async function getTranslator() {
  return translator(await getLocale());
}
