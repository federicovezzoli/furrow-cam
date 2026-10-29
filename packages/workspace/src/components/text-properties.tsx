"use client";

import { MIN_LETTER_SPACING, type TextAlign, type TextSettings } from "@furrow/document";
import { NumberField } from "@furrow/ui/components/number-field";
import { Button } from "@furrow/ui/components/ui/button";
import { Label } from "@furrow/ui/components/ui/label";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@furrow/ui/components/ui/native-select";
import { Textarea } from "@furrow/ui/components/ui/textarea";
import { useFormatMessage } from "@furrow/ui/hooks/use-format-message";
import type { Translatable } from "@furrow/ui/lib/i18n";
import { ShapesIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { FONTS } from "../lib/fonts";
import { convertText, editText, textSettled, uploadedFonts, uploadFont } from "../lib/text-items";
import { useWorkspaceHost } from "../providers/workspace-host";
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
  const uploaded = useDocumentStore((s) => s.document.fonts);
  const host = useWorkspaceHost();
  const fontInput = useRef<HTMLInputElement>(null);
  /** Whether the next uploaded font is single-stroke, as the user says (ADR-0062). */
  const [singleStroke, setSingleStroke] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    const result = await editText(store, drawingId, edits, uploadedFonts(store, host.fonts));
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

  /** Uploads `file` as a font, then sets the text in it (PRD-0010 T7). */
  async function upload(file: File) {
    setUploading(true);
    const result = await uploadFont(store, host, file, singleStroke);
    setUploading(false);
    if (!result.ok) return setError(result.error);
    await edit({ font: result.sha256 });
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
          {!FONTS.some((font) => font.id === text.font) &&
            !uploaded.some((font) => font.sha256 === text.font) && (
              <NativeSelectOption value={text.font}>{text.font}</NativeSelectOption>
            )}
          <NativeSelectOptGroup label={t("included")}>
            {FONTS.map((font) => (
              <NativeSelectOption key={font.id} value={font.id}>
                {font.name}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
          {uploaded.length > 0 && (
            <NativeSelectOptGroup label={t("uploaded")}>
              {uploaded.map((font) => (
                <NativeSelectOption key={font.sha256} value={font.sha256}>
                  {font.name}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          )}
        </NativeSelect>
      </Row>
      {host.limits.fonts && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fontInput}
            type="file"
            accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Lets the same file be picked again, e.g. with the other stroke choice.
              event.currentTarget.value = "";
              if (file) void upload(file);
            }}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
          />
          <Button
            variant="outline"
            size="compact"
            disabled={uploading}
            onClick={() => fontInput.current?.click()}
          >
            <UploadIcon />
            {t("upload")}
          </Button>
          <div className="flex items-center gap-1.5">
            <input
              type="checkbox"
              id="text-single-stroke"
              checked={singleStroke}
              onChange={(event) => setSingleStroke(event.target.checked)}
              className="size-3.5 accent-primary"
            />
            <Label htmlFor="text-single-stroke" className="text-ui font-normal">
              {t("singleStroke")}
            </Label>
          </div>
        </div>
      )}
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
        min={MIN_LETTER_SPACING * 100}
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
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="compact"
          onClick={async () => {
            const result = await convertText(store, drawingId);
            if (!result.ok) setError(result.error);
          }}
          title={t("convertTitle")}
        >
          <ShapesIcon />
          {t("convert")}
        </Button>
      </div>
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
