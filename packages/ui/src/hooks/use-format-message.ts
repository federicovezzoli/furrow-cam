import { useTranslations } from "use-intl";
import { formatMessage, type Translatable } from "../lib/i18n";

/** Formats text or a core package's message in the app's language (ADR-0054). */
export function useFormatMessage() {
  const t = useTranslations();
  return (message: Translatable) => formatMessage(t, message);
}
