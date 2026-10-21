import { describe, expect, it } from "vitest";
import { CATALOGS, type Catalog, messagesFor, translator } from "./i18n";
import { LOCALES, matchLocale, parseAcceptLanguage } from "./locales";

function keys(messages: Catalog, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe("catalogs", () => {
  const english = keys(CATALOGS.en).sort();
  it.each(LOCALES.filter((locale) => locale !== "en"))("%s has every English key", (locale) => {
    expect(keys(CATALOGS[locale]).sort()).toEqual(english);
  });
});

describe("messagesFor", () => {
  it("falls back to English for a missing key", () => {
    const original = CATALOGS.it;
    CATALOGS.it = { Nav: { projects: "Progetti" } };
    try {
      const messages = messagesFor("it");
      expect(messages.Nav).toMatchObject({ projects: "Progetti", bits: "Bits" });
      expect(messages.LanguagePicker).toEqual(CATALOGS.en.LanguagePicker);
    } finally {
      CATALOGS.it = original;
    }
  });

  it("formats ICU messages", () => {
    expect(translator("en")("ThemeToggle.switchTo", { theme: "dark" })).toBe(
      "Switch to dark theme",
    );
  });
});

describe("matchLocale", () => {
  it("matches on the primary subtag", () => {
    expect(matchLocale(["it-CH", "en"])).toBe("it");
    expect(matchLocale(["de_AT"])).toBe("de");
  });

  it("skips unsupported languages and falls back to English", () => {
    expect(matchLocale(["es-ES", "fr"])).toBe("fr");
    expect(matchLocale(["ja"])).toBe("en");
    expect(matchLocale([])).toBe("en");
  });
});

describe("parseAcceptLanguage", () => {
  it("orders by quality, then by position", () => {
    expect(parseAcceptLanguage("en;q=0.5, fr-CH, de;q=0.9, it;q=0.9")).toEqual([
      "fr-CH",
      "de",
      "it",
      "en",
    ]);
  });

  it("drops q=0, wildcards and empty headers", () => {
    expect(parseAcceptLanguage("it;q=0, *, en")).toEqual(["en"]);
    expect(parseAcceptLanguage(null)).toEqual([]);
  });
});
