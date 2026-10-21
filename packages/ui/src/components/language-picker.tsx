"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { isLocale, LOCALE_NAMES, LOCALES } from "../lib/locales";
import { useChangeLocale } from "./locale-provider";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Overrides the language detected from the browser or the system (ADR-0054). */
export function LanguagePicker({ size = "icon-sm" }: { size?: "icon-sm" | "icon-compact" }) {
  const t = useTranslations("LanguagePicker");
  const locale = useLocale();
  const changeLocale = useChangeLocale();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={size} aria-label={t("label")} title={t("label")}>
          <LanguagesIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (isLocale(value) && value !== locale) changeLocale(value);
          }}
        >
          {LOCALES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} lang={option}>
              {LOCALE_NAMES[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
