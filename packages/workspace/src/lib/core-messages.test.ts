import { IMPORT_MESSAGES, QUANTITY_MESSAGES, TOOLPATH_MESSAGES } from "@furrow/cam-core";
import { DOCUMENT_MESSAGES, PRESET_MESSAGES } from "@furrow/document";
import { POST_MESSAGES } from "@furrow/post";
import { CATALOGS, type Catalog } from "@furrow/ui/lib/i18n";
import { LOCALES } from "@furrow/ui/lib/locales";
import { describe, expect, it } from "vitest";

/** Every code the core packages can give (ADR-0054). */
const CODES = [
  ...DOCUMENT_MESSAGES,
  ...PRESET_MESSAGES,
  ...QUANTITY_MESSAGES,
  ...IMPORT_MESSAGES,
  ...TOOLPATH_MESSAGES,
  ...POST_MESSAGES,
];

function entry(catalog: Catalog, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Catalog | undefined)?.[part], catalog);
}

describe("core package messages", () => {
  it.each(LOCALES)("are all in the %s catalog", (locale) => {
    const missing = CODES.filter(
      (code) => typeof entry(CATALOGS[locale], `Core.${code}`) !== "string",
    );
    expect(missing).toEqual([]);
  });
});
