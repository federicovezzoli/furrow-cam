import { formatQuantity, unitLabel } from "@furrow/cam-core";
import type { Units } from "@furrow/document";
import { localizeDecimal } from "@furrow/ui/lib/locales";
import { useLocale } from "use-intl";

/** Formats a length in millimetres as text with its unit, in `units` and the app's language. */
export function useLength(units: Units) {
  const locale = useLocale();
  return (mm: number) =>
    `${localizeDecimal(formatQuantity(mm, "length", units), locale)} ${unitLabel("length", units)}`;
}
