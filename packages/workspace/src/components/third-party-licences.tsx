"use client";

import { useState } from "react";
import { useTranslations } from "use-intl";
import { FONTS } from "../lib/font-files";
import { OCCT_LICENCES, OCCT_VERSION } from "../lib/occt-licences";

/** What the apps ship whose licence asks for a notice: built from what ships, so none goes missing. */
const ENTRIES = [
  {
    name: "OpenCascade (occt-import-js)",
    version: OCCT_VERSION,
    licence: "LGPL-2.1",
    texts: OCCT_LICENCES,
    sources: [
      "https://github.com/kovacsv/occt-import-js",
      "https://github.com/Open-Cascade-SAS/OCCT",
    ],
  },
  ...FONTS.map((font) => ({
    name: font.name,
    version: null,
    licence: "SIL Open Font License 1.1",
    texts: [{ name: font.name, url: font.licence }],
    sources: [],
  })),
];

/**
 * The third-party code and fonts the apps ship, with their licence texts as
 * shipped, read from the app itself so they open offline (LGPL-2.1 §6, OFL).
 */
export function ThirdPartyLicences() {
  const t = useTranslations("Licences");
  return (
    <section className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>
      <ul className="grid gap-4">
        {ENTRIES.map((entry) => (
          <li key={entry.name} className="grid gap-2 rounded-md border p-4">
            <h2 className="font-medium">
              {entry.name}
              {entry.version && <span className="text-muted-foreground"> {entry.version}</span>}
            </h2>
            <p className="text-muted-foreground">{t("licence", { licence: entry.licence })}</p>
            {entry.sources.length > 0 && (
              <p className="flex flex-wrap gap-x-3">
                {t("source")}
                {entry.sources.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {url.replace("https://", "")}
                  </a>
                ))}
              </p>
            )}
            {entry.texts.map((text) => (
              <LicenceText key={text.url.href} {...text} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A shipped licence file, read when first opened; opening it again after a failure retries. */
function LicenceText({ name, url }: { name: string; url: URL }) {
  const t = useTranslations("Licences");
  const [text, setText] = useState<{ text: string } | "loading" | "error" | null>(null);
  return (
    <details
      onToggle={(event) => {
        if (!event.currentTarget.open || (text !== null && text !== "error")) return;
        setText("loading");
        fetch(url)
          .then((response) => (response.ok ? response.text() : Promise.reject(response)))
          .then(
            (loaded) => setText({ text: loaded }),
            () => setText("error"),
          );
      }}
    >
      <summary className="cursor-pointer">{t("text", { name })}</summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
        {typeof text === "object" && text
          ? text.text
          : t(text === "error" ? "unavailable" : "loading")}
      </pre>
    </details>
  );
}
