"use client";

import type { TextAlign, TextSettings } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import type * as React from "react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { FONTS } from "../lib/fonts";
import { editText } from "../lib/text-items";
import { useDocumentStore, useDocumentStoreApi } from "../providers/workspace-stores";
import { OperationNameInput } from "./operation-name-input";

/** Keeps the height positive when stepping down. */
const MIN_HEIGHT = 0.01;

const ALIGNS: readonly TextAlign[] = ["left", "center", "right"];

const SELECT_CLASS = "h-control px-2 pr-7 text-ui";

/**
 * A text item's settings (PRD-0010 T1, T3): its text, font, cap height and
 * alignment. Each edit is laid out again off the main thread and lands as one
 * undo step, keeping the item's placement and the operations machining it.
 */
export function TextProperties({ drawingId, text }: { drawingId: string; text: TextSettings }) {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  /** Why the last edit was refused. */
  const [error, setError] = useState<Translatable | null>(null);
  const t = useTranslations("Text");
  const format = useFormatMessage();

  async function edit(edits: Partial<Omit<TextSettings, "placement">>) {
    const result = await editText(store, drawingId, edits);
    setError(result.ok ? null : result.error);
  }

  return (
    <section aria-labelledby="text-heading" className="grid gap-2">
      <h3 id="text-heading" className="font-medium">
        {t("heading")}
      </h3>
      <Row id="text-text" label={t("text")}>
        <OperationNameInput
          id="text-text"
          name={text.text}
          onRename={(value) => {
            if (!/\S/.test(value)) {
              setError({ code: "validation.blank" });
              return { ok: true };
            }
            void edit({ text: value });
            return { ok: true };
          }}
        />
      </Row>
      <Row id="text-font" label={t("font")}>
        <NativeSelect
          id="text-font"
          size="sm"
          value={text.font}
          onChange={(event) => void edit({ font: event.target.value })}
          className={SELECT_CLASS}
        >
          {!FONTS.some((font) => font.id === text.font) && (
            <NativeSelectOption value={text.font}>{text.font}</NativeSelectOption>
          )}
          {FONTS.map((font) => (
            <NativeSelectOption key={font.id} value={font.id}>
              {font.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <NumberField
        id="text-height"
        label={t("height")}
        layout="inline"
        quantity="length"
        units={units}
        min={MIN_HEIGHT}
        value={text.height}
        onValueChange={(height) => void edit({ height })}
      />
      <Row id="text-align" label={t("align")}>
        <NativeSelect
          id="text-align"
          size="sm"
          value={text.align}
          onChange={(event) => void edit({ align: event.target.value as TextAlign })}
          className={SELECT_CLASS}
        >
          {ALIGNS.map((align) => (
            <NativeSelectOption key={align} value={align}>
              {t(`aligns.${align}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>
      <p className="text-muted-foreground">{t("heightNote")}</p>
      {error && (
        <p role="alert" className="text-destructive">
          {format(error)}
        </p>
      )}
    </section>
  );
}

function Row({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
      <Label htmlFor={id} className="text-ui font-normal">
        {label}
      </Label>
      {children}
    </div>
  );
}
