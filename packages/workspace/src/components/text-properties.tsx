"use client";

import type { TextAlign, TextSettings } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Label } from "@furrow/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@furrow/ui/components/ui/native-select";
import { Textarea } from "@furrow/ui/components/ui/textarea";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { FONTS } from "../lib/fonts";
import { editText, textSettled } from "../lib/text-items";
import {
  useDocumentStore,
  useDocumentStoreApi,
  useWorkspaceStoreApi,
} from "../providers/workspace-stores";
import { drawingShapes } from "../stores/geometry-actions";
import { Row } from "./operation-properties";

/** Keeps the height positive when stepping down. */
const MIN_HEIGHT = 0.01;

/** Keeps lines from landing on each other when stepping down. */
const MIN_LINE_SPACING = 0.1;

const ALIGNS: readonly TextAlign[] = ["left", "center", "right"];

const SELECT_CLASS = "h-control px-2 pr-7 text-ui";

/**
 * A text item's settings (PRD-0010 T1, T3, T5, T6): its text, over one or
 * more lines, font, cap height, line and letter spacing and alignment. Each
 * edit is laid out again off the main thread and lands as one
 * undo step, keeping the item's placement and the operations machining it.
 */
export function TextProperties({ drawingId, text }: { drawingId: string; text: TextSettings }) {
  const store = useDocumentStoreApi();
  const workspace = useWorkspaceStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  /** Why the last edit was refused. */
  const [error, setError] = useState<Translatable | null>(null);
  /** How many tabs the last edit took off the text, which no longer lay on its letters. */
  const [removedTabs, setRemovedTabs] = useState(0);
  const t = useTranslations("Text");
  const format = useFormatMessage();

  // A scrub or held arrow is one undo step: its layouts land before it ends.
  const gestures = {
    onGestureStart: () => store.getState().beginTransaction(),
    onGestureEnd: async (cancelled: boolean) => {
      await textSettled(drawingId);
      const state = store.getState();
      if (cancelled) state.cancelTransaction();
      else state.commitTransaction();
    },
  };

  /** Applies `edits` once laid out; whether they were. */
  async function edit(edits: Partial<Omit<TextSettings, "placement">>): Promise<boolean> {
    const result = await editText(store, drawingId, edits);
    setError(result.ok ? null : result.error);
    if (!result.ok) return false;
    setRemovedTabs(result.removedTabs);
    // The new outlines are numbered afresh: select all of them, as adding the text did.
    const [shape] = drawingShapes(store.getState().document.geometry, drawingId);
    if (shape) {
      workspace.getState().selectPaths(shape.paths.map((_, path) => ({ shapeId: shape.id, path })));
    }
    return true;
  }

  return (
    <section aria-labelledby="text-heading" className="grid gap-2">
      <h3 id="text-heading" className="font-medium">
        {t("heading")}
      </h3>
      <div className="grid gap-1">
        <Label htmlFor="text-text" className="text-ui font-normal">
          {t("text")}
        </Label>
        <TextField
          id="text-text"
          text={text.text}
          // Blank text has nothing to cut: the field goes back to the text, as a blank name does.
          onCommit={async (value) => !/\S/.test(value) || (await edit({ text: value }))}
        />
      </div>
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
        {...gestures}
      />
      <NumberField
        id="text-line-spacing"
        label={t("lineSpacing")}
        layout="inline"
        quantity="number"
        suffix="×"
        min={MIN_LINE_SPACING}
        step={0.1}
        value={text.lineSpacing}
        onValueChange={(lineSpacing) => void edit({ lineSpacing })}
        {...gestures}
      />
      <NumberField
        id="text-letter-spacing"
        label={t("letterSpacing")}
        layout="inline"
        quantity="number"
        // A share of the letter height, so it scales with the text.
        suffix="%"
        value={text.letterSpacing * 100}
        onValueChange={(percent) => void edit({ letterSpacing: percent / 100 })}
        {...gestures}
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
      {removedTabs > 0 && (
        <p role="status" className="text-muted-foreground">
          {t("tabsRemoved", { count: removedTabs })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {format(error)}
        </p>
      )}
    </section>
  );
}

/**
 * The text, a line per line (PRD-0010 T5): it changes on blur or Ctrl/⌘+Enter,
 * Enter starts a new line, and Escape puts the text back. What was typed
 * stays until the change lands, and after it is refused, so a long text isn't
 * lost to a character the font lacks.
 */
function TextField({
  id,
  text,
  onCommit,
}: {
  id: string;
  text: string;
  /** Whether `text` was taken; if not, the field keeps showing it. */
  onCommit: (text: string) => Promise<boolean>;
}) {
  /** What's typed while editing, or waiting to land; `null` shows the text. */
  const [draft, setDraft] = useState<string | null>(null);

  function finish(commit: boolean) {
    if (!commit || draft === null || draft === text) return setDraft(null);
    const typed = draft;
    void onCommit(typed).then((taken) => {
      // Unless the user typed on meanwhile.
      if (taken) setDraft((current) => (current === typed ? null : current));
    });
  }

  return (
    <Textarea
      id={id}
      value={draft ?? text}
      rows={2}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      className="min-h-0 px-2 py-1 text-ui md:text-ui"
    />
  );
}
