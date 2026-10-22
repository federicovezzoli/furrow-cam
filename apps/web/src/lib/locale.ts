import "server-only";
import { translator } from "@furrow/ui/lib/i18n";
import { headers } from "next/headers";
import { cache } from "react";
import { requestLocale } from "./locale-cookie";

/** The request's interface language (ADR-0054). Request data: call it inside `<Suspense>`. */
export const getLocale = cache(async () => requestLocale(await headers()));

/** Translates in server components, in the request's language. */
export async function getTranslator() {
  return translator(await getLocale());
}
