import { PLACEHOLDERS } from "@furrow/post";
import { useTranslations } from "use-intl";

/** The placeholders the post fills in a custom block, as a sentence for a hint. */
export function PlaceholderList() {
  const t = useTranslations("Placeholders");
  // Passed as values: written in a message, ICU would read their braces as arguments.
  const [padX, padY, safeZ] = PLACEHOLDERS;
  return t.rich("list", { padX, padY, safeZ, code: (chunks) => <code>{chunks}</code> });
}
