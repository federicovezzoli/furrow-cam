/**
 * The interface languages (ADR-0054). No React and no catalogs, so the
 * desktop main process can pick a language too.
 */
export const LOCALES = ["en", "it", "fr", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name in itself, as the language picker lists it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  it: "Italiano",
  fr: "Français",
  de: "Deutsch",
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/**
 * The first supported language in `preferred` (most preferred first), matched
 * on the primary subtag so `it-CH` gives `it`, else English.
 */
export function matchLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const language = tag.split(/[-_]/)[0]?.toLowerCase();
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

/** The languages in an `Accept-Language` header, most preferred first, without `q=0` ones. */
export function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return (
    header
      .split(",")
      .map((part, index) => {
        const [tag = "", ...params] = part.trim().split(";");
        const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
        const quality = q ? Number(q.slice(2)) : 1;
        return { tag: tag.trim(), quality: Number.isNaN(quality) ? 0 : quality, index };
      })
      .filter(({ tag, quality }) => tag !== "" && tag !== "*" && quality > 0)
      // Stable on equal quality: the header's order breaks ties.
      .sort((a, b) => b.quality - a.quality || a.index - b.index)
      .map(({ tag }) => tag)
  );
}
