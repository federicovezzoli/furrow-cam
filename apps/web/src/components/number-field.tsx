"use client";

import {
  formatQuantity,
  fromInternal,
  parseQuantity,
  type Quantity,
  snapToStep,
  toInternal,
  unitLabel,
} from "@furrow/cam-core";
import type { Units } from "@furrow/document";
import { cn } from "cn";
import type * as React from "react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One arrow-key step, in display units; Shift multiplies it by 10 and Alt by 0.1. */
const DEFAULT_STEPS: Record<Quantity, Record<Units, number>> = {
  length: { mm: 1, in: 0.1 },
  feed: { mm: 10, in: 1 },
  number: { mm: 1, in: 1 },
};

/** Pointer travel, in pixels, that scrubs the value by one step. */
const PIXELS_PER_STEP = 4;
/** Pointer travel before a press on the label becomes a scrub rather than a click. */
const SCRUB_THRESHOLD = 3;

type Scrub = {
  pointerX: number;
  start: number | null;
  /** Listens for Escape while scrubbing, which cancels the scrub. */
  onKeyDown: ((event: KeyboardEvent) => void) | null;
};

export type NumberFieldProps = {
  id: string;
  label: React.ReactNode;
  /** Decides the unit suffixes accepted and how the value is shown (default: a plain number). */
  quantity?: Quantity;
  /** Display units; the value itself is always in the internal unit (mm, mm/min). */
  units?: Units;
  /** Controlled value in the internal unit. Leave it out and use `defaultValue` in a form. */
  value?: number | null;
  defaultValue?: number | null;
  /** Called with each committed value: on Enter or blur, each arrow step and each scrub move. */
  onValueChange?: (value: number) => void;
  /** A scrub starts: the calls to `onValueChange` until it ends form one gesture. */
  onScrubStart?: () => void;
  /** A scrub ends, `cancelled` when Escape was pressed, which should restore the value. */
  onScrubEnd?: (cancelled: boolean) => void;
  /** Submits the value, in the internal unit, under this name in a form. */
  name?: string;
  /** Inclusive limits in the internal unit: typed values outside are errors, steps stop at them. */
  min?: number;
  max?: number;
  /** One arrow-key step in display units. */
  step?: number;
  /** Shown inside the input instead of the display unit, e.g. `RPM` or `%`. */
  suffix?: string;
  /** An error from elsewhere, e.g. the server; a parse error takes its place while shown. */
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  /** `stacked` puts the label above the input (forms), `inline` beside it (workspace panels). */
  layout?: "stacked" | "inline";
  className?: string;
};

/**
 * A unit-aware numeric input (ADR-0009, PRD-0001 R14). Accepts numbers and
 * simple expressions with an optional unit (`6.35`, `1/4in`, `10/2`) and
 * shows the value in the display units. Arrow keys step the value and
 * dragging the label sideways scrubs it.
 */
export function NumberField({
  id,
  label,
  quantity = "number",
  units = "mm",
  value,
  defaultValue = null,
  onValueChange,
  onScrubStart,
  onScrubEnd,
  name,
  min,
  max,
  step = DEFAULT_STEPS[quantity][units],
  suffix = unitLabel(quantity, units),
  error,
  placeholder,
  disabled,
  layout = "stacked",
  className,
}: NumberFieldProps) {
  const [ownValue, setOwnValue] = useState(defaultValue);
  const current = value === undefined ? ownValue : value;
  /** What's typed while editing; `null` shows the current value. */
  const [draft, setDraft] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const scrub = useRef<Scrub | null>(null);
  const justScrubbed = useRef(false);

  const text = draft ?? (current === null ? "" : formatQuantity(current, quantity, units));
  const shownError = parseError ?? error;

  function update(next: number) {
    setOwnValue(next);
    onValueChange?.(next);
  }

  function clamp(next: number) {
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
  }

  function rangeError(next: number): string | null {
    const withUnit = (limit: number) =>
      `${formatQuantity(limit, quantity, units)}${suffix ? ` ${suffix}` : ""}`;
    if (min !== undefined && next < min) return `Must be at least ${withUnit(min)}`;
    if (max !== undefined && next > max) return `Must be at most ${withUnit(max)}`;
    return null;
  }

  /** Commits what was typed; on an error the text stays, so it can be fixed. */
  function commit() {
    if (draft === null) return;
    // A form field may be left blank; the form decides whether that's allowed.
    if (draft.trim() === "" && value === undefined) {
      setOwnValue(null);
      setDraft(null);
      setParseError(null);
      return;
    }
    const result = parseQuantity(draft, quantity, units);
    const problem = result.ok ? rangeError(result.value) : result.error;
    if (problem !== null || !result.ok) {
      setParseError(problem);
      return;
    }
    setDraft(null);
    setParseError(null);
    update(result.value);
  }

  function revert() {
    setDraft(null);
    setParseError(null);
  }

  /** `steps` steps in display units, each 10× larger with Shift and 10× smaller with Alt. */
  function stepBy(steps: number, event: React.KeyboardEvent | React.PointerEvent) {
    const size = step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
    return snapToStep(steps * size, size);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape" && draft !== null) {
      event.preventDefault();
      revert();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const typed = draft === null ? null : parseQuantity(draft, quantity, units);
      const start = typed?.ok ? typed.value : (current ?? 0);
      const delta = stepBy(event.key === "ArrowUp" ? 1 : -1, event);
      const display = fromInternal(start, quantity, units) + delta;
      revert();
      update(clamp(toInternal(Number(display.toFixed(10)), quantity, units)));
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLLabelElement>) {
    if (event.button !== 0 || disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    justScrubbed.current = false;
    scrub.current = { pointerX: event.clientX, start: current, onKeyDown: null };
  }

  function onPointerMove(event: React.PointerEvent<HTMLLabelElement>) {
    const state = scrub.current;
    if (!state) return;
    const distance = event.clientX - state.pointerX;
    if (!state.onKeyDown) {
      if (Math.abs(distance) < SCRUB_THRESHOLD) return;
      state.onKeyDown = (key) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        endScrub(true);
      };
      window.addEventListener("keydown", state.onKeyDown);
      revert();
      onScrubStart?.();
    }
    const start = fromInternal(state.start ?? 0, quantity, units);
    const delta = stepBy(Math.round(distance / PIXELS_PER_STEP), event);
    const next = clamp(toInternal(Number((start + delta).toFixed(10)), quantity, units));
    if (next !== current) update(next);
  }

  function endScrub(cancelled: boolean) {
    const state = scrub.current;
    scrub.current = null;
    if (!state?.onKeyDown) return;
    window.removeEventListener("keydown", state.onKeyDown);
    justScrubbed.current = true;
    if (cancelled) setOwnValue(state.start);
    onScrubEnd?.(cancelled);
  }

  /** Text that parses goes to the form as a value; anything else as typed, for the server to reject. */
  function submittedValue(): string {
    if (draft === null) return current === null ? "" : String(current);
    const result = parseQuantity(draft, quantity, units);
    return result.ok ? String(result.value) : draft;
  }

  const errorId = `${id}-error`;
  return (
    <div
      className={cn(
        layout === "stacked"
          ? "grid content-start gap-2"
          : "grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2 gap-y-1",
        className,
      )}
    >
      <Label
        htmlFor={id}
        title="Drag sideways to change"
        className={cn("cursor-ew-resize touch-none", layout === "inline" && "text-ui font-normal")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endScrub(false)}
        onPointerCancel={() => endScrub(true)}
        onClick={(event) => {
          // The press that ends a scrub isn't a click on the label: don't focus the input.
          if (justScrubbed.current) event.preventDefault();
          justScrubbed.current = false;
        }}
      >
        {label}
        {suffix && <span className="sr-only"> ({suffix})</span>}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? errorId : undefined}
          className={cn(
            "tabular-nums",
            layout === "inline" && "h-control px-2 text-ui md:text-ui",
            suffix && (layout === "inline" ? "pr-14" : "pr-16"),
          )}
        />
        {suffix && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 flex items-center text-muted-foreground",
              layout === "inline" ? "pr-2 text-ui" : "pr-3 text-sm",
            )}
          >
            {suffix}
          </span>
        )}
      </div>
      {name !== undefined && <input type="hidden" name={name} value={submittedValue()} />}
      {shownError && (
        <p
          id={errorId}
          className={cn(
            "text-destructive",
            layout === "inline" ? "col-start-2 text-ui" : "text-sm",
          )}
        >
          {shownError}
        </p>
      )}
    </div>
  );
}
