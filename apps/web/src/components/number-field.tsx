"use client";

import {
  formatQuantity,
  fromInternal,
  parseQuantity,
  type Quantity,
  toInternal,
  unitLabel,
} from "@furrow/cam-core";
import type { Units } from "@furrow/document";
import { cn } from "cn";
import type * as React from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
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

/** A press on the label, which becomes a scrub once the pointer moves far enough. */
type Press = {
  /** Where the pointer was when the value last moved; travel since then isn't spent yet. */
  pointerX: number;
  /** The value in display units. */
  display: number;
  scrubbing: boolean;
};

/** A scrub or a held arrow key: its changes form one undo step. */
type Gesture = {
  start: number | null;
  /** Escape cancels the gesture wherever the focus is. */
  onKeyDown: (event: KeyboardEvent) => void;
};

const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown"]);

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
  /**
   * A gesture starts (a scrub, or an arrow key held down): the calls to
   * `onValueChange` until it ends form one undo step.
   */
  onGestureStart?: () => void;
  /**
   * A gesture ends, `cancelled` on Escape or when the field goes away
   * mid-gesture, which should restore the value from before it.
   */
  onGestureEnd?: (cancelled: boolean) => void;
  /** Submits the value, in the internal unit, under this name in a form. */
  name?: string;
  /** Inclusive limits in the internal unit: typed values outside are errors, steps stop at them. */
  min?: number;
  max?: number;
  /** Only whole numbers, e.g. a count: steps never go below 1. */
  integer?: boolean;
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
  onGestureStart,
  onGestureEnd,
  name,
  min,
  max,
  integer = false,
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
  const press = useRef<Press | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const justScrubbed = useRef(false);

  // Unmounting mid-gesture would otherwise leave it open, e.g. a document transaction.
  const cancelOpenGesture = useEffectEvent(() => endGesture(true));
  useEffect(() => () => cancelOpenGesture(), []);

  const text = draft ?? (current === null ? "" : formatQuantity(current, quantity, units));
  const shownError = parseError ?? error;

  function update(next: number) {
    setOwnValue(next);
    onValueChange?.(next);
  }

  /** A display value moved by steps or a scrub, made whole or freed of floating-point noise. */
  function settle(display: number) {
    return integer ? Math.round(display) : Number(display.toFixed(10));
  }

  /** A display value as the internal value to store, within the limits. */
  function toValue(display: number) {
    const next = toInternal(settle(display), quantity, units);
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
  }

  function valueError(next: number): string | null {
    if (integer && !Number.isInteger(next)) return "Must be a whole number";
    // Rounded inwards, so typing the limit as shown is accepted.
    const limit = (bound: number, rounding: "up" | "down") =>
      `${formatQuantity(bound, quantity, units, rounding)}${suffix ? ` ${suffix}` : ""}`;
    if (min !== undefined && next < min) return `Must be at least ${limit(min, "up")}`;
    if (max !== undefined && next > max) return `Must be at most ${limit(max, "down")}`;
    return null;
  }

  /** Commits what was typed; on an error the text stays, so it can be fixed. */
  function commit() {
    if (draft === null) return;
    // A form field may be left blank; the form decides whether that's allowed.
    if (draft.trim() === "" && value === undefined) {
      setOwnValue(null);
      revert();
      return;
    }
    const result = parseQuantity(draft, quantity, units);
    const problem = result.ok ? valueError(result.value) : result.error;
    if (problem !== null || !result.ok) {
      setParseError(problem);
      return;
    }
    revert();
    update(result.value);
  }

  function revert() {
    setDraft(null);
    setParseError(null);
  }

  /** One step in display units, 10× larger with Shift and 10× smaller with Alt. */
  function stepSize(event: React.KeyboardEvent | React.PointerEvent) {
    const size = step * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1);
    return integer ? Math.max(1, Math.round(size)) : size;
  }

  function beginGesture() {
    if (gesture.current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      endGesture(true);
    };
    gesture.current = { start: current, onKeyDown };
    window.addEventListener("keydown", onKeyDown);
    onGestureStart?.();
  }

  function endGesture(cancelled: boolean) {
    const open = gesture.current;
    if (!open) return;
    gesture.current = null;
    // A cancelled scrub stops following the pointer.
    press.current = null;
    window.removeEventListener("keydown", open.onKeyDown);
    if (cancelled) setOwnValue(open.start);
    onGestureEnd?.(cancelled);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape" && draft !== null) {
      event.preventDefault();
      revert();
    } else if (ARROW_KEYS.has(event.key)) {
      event.preventDefault();
      const typed = draft === null ? null : parseQuantity(draft, quantity, units);
      const start = typed?.ok ? typed.value : (current ?? 0);
      const delta = (event.key === "ArrowUp" ? 1 : -1) * stepSize(event);
      revert();
      // Holding the key repeats it; the whole hold is one gesture, ended on keyup.
      beginGesture();
      update(toValue(fromInternal(start, quantity, units) + delta));
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLLabelElement>) {
    if (event.button !== 0 || disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    justScrubbed.current = false;
    press.current = {
      pointerX: event.clientX,
      display: fromInternal(current ?? 0, quantity, units),
      scrubbing: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLLabelElement>) {
    const state = press.current;
    if (!state) return;
    const distance = event.clientX - state.pointerX;
    if (!state.scrubbing) {
      if (Math.abs(distance) < SCRUB_THRESHOLD) return;
      state.scrubbing = true;
      state.pointerX = event.clientX;
      // The press that ends a scrub isn't a click on the label.
      justScrubbed.current = true;
      revert();
      beginGesture();
      return;
    }
    const steps = Math.trunc(distance / PIXELS_PER_STEP);
    if (steps === 0) return;
    // Only the travel spent moves on, so a modifier pressed now applies from here, without a jump.
    state.pointerX += steps * PIXELS_PER_STEP;
    const next = toValue(state.display + steps * stepSize(event));
    state.display = fromInternal(next, quantity, units);
    if (next !== current) update(next);
  }

  /** The press ends: released, or its pointer capture lost (e.g. the window lost focus). */
  function endPress(cancelled: boolean) {
    const state = press.current;
    press.current = null;
    if (state?.scrubbing) endGesture(cancelled);
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
        onPointerUp={() => endPress(false)}
        onLostPointerCapture={() => endPress(false)}
        onPointerCancel={() => endPress(true)}
        onClick={(event) => {
          // Don't focus the input after a scrub.
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
          onBlur={() => {
            endGesture(false);
            commit();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            if (ARROW_KEYS.has(event.key)) endGesture(false);
          }}
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
