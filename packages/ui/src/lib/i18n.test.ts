import { createTranslator } from "use-intl/core";
import { describe, expect, it } from "vitest";
import {
  CATALOGS,
  type Catalog,
  formatMessage,
  type KeyMessage,
  messagesFor,
  translator,
} from "./i18n";
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

describe("every message", () => {
  it.each(LOCALES)("formats in %s, with its tags and arguments", (locale) => {
    const errors: string[] = [];
    const t = createTranslator({
      locale,
      messages: CATALOGS[locale],
      onError: (error) => errors.push(error.message),
    });
    for (const key of keys(CATALOGS[locale])) {
      const raw = key
        .split(".")
        .reduce<Catalog | string>((node, part) => (node as Catalog)[part] ?? "", CATALOGS[locale]);
      // Every tag wraps its text and any argument accepts 1: what's left is broken syntax.
      const tags = [...String(raw).matchAll(/<(\w+)>/g)].map((match) => [
        match[1],
        (chunks: string) => `[${chunks}]`,
      ]);
      const args = [...String(raw).matchAll(/\{(\w+)/g)].map((match) => [match[1], 1]);
      const values = Object.fromEntries([...args, ...tags]);
      const text = t.markup(key as never, values as never);
      if (/[<>{}]/.test(text)) errors.push(`${key}: ${text}`);
    }
    expect(errors).toEqual([]);
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

describe("translator", () => {
  it("is built once per language", () => {
    expect(translator("it")).toBe(translator("it"));
    expect(translator("it")).not.toBe(translator("de"));
  });
});

describe("formatMessage", () => {
  const t = translator("en");

  it("looks a key message up by its full key, translating the messages in it", () => {
    const message: KeyMessage = {
      key: "Projects.saveFailed",
      values: {
        reason: [
          {
            key: "Projects.issueAt",
            values: { message: { code: "validation.required" }, path: "name" },
          },
          "as is",
        ],
      },
    };
    expect(formatMessage(t, message)).toBe(
      `The project couldn't be saved: ✖ ${t("Core.validation.required")} → name\nas is`,
    );
  });

  it("looks a core message up under Core", () => {
    expect(formatMessage(t, { code: "validation.required" })).toBe(t("Core.validation.required"));
  });
});

describe("core message numbers", () => {
  it("are written as the language writes them", () => {
    expect(translator("de")("Core.stl.tooManyTriangles", { max: 2_000_000 })).toContain(
      "2.000.000",
    );
  });
});
