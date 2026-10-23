"use client";

import { Button } from "@furrow/ui/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@furrow/ui/components/ui/popover";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "use-intl";
import {
  dropStep,
  isOnScreen,
  moveTour,
  startTour,
  TOURS,
  type TourId,
  type TourPane,
  type TourState,
  type TourStep,
} from "../lib/tour";

/**
 * Tours finished or skipped since the page loaded, as `<user id>:<tour>`: the
 * server's timestamps only come back on the next load, so this keeps a tour
 * from starting again on a client-side navigation. Keyed by user, since
 * another account can sign in without a reload.
 */
const finished = new Set<string>();

/**
 * Whether tour `id` is running, starting it on mount when `autoStart` holds
 * and the account `userId` hasn't finished it (`done`). `start` takes the
 * element to give focus back to when the tour ends. `end` stops it and, the
 * first time a step was `seen`, calls `finish` to store on the account that
 * the tour was seen, without waiting for the save.
 */
export function useTour(
  id: TourId,
  {
    userId,
    done,
    autoStart,
    finish,
  }: {
    userId: string;
    done: boolean;
    autoStart: boolean;
    finish: (tour: TourId) => Promise<void>;
  },
) {
  const [running, setRunning] = useState(false);
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const key = `${userId}:${id}`;

  useEffect(() => {
    if (autoStart && !done && !finished.has(key)) setRunning(true);
  }, [key, done, autoStart]);

  const start = useCallback((from?: HTMLElement | null) => {
    setOrigin(from ?? null);
    setRunning(true);
  }, []);
  const end = useCallback(
    (seen: boolean) => {
      setRunning(false);
      if (!seen || done || finished.has(key)) return;
      finished.add(key);
      finish(id).catch((error: unknown) => {
        console.error(`Failed to remember that the ${id} tour was seen`, error);
      });
    },
    [id, key, done, finish],
  );

  return { running, origin, start, end };
}

function findAnchor(name: string) {
  return document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
}

function onScreen(element: HTMLElement | null): element is HTMLElement {
  return (
    element !== null &&
    isOnScreen(element.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    })
  );
}

/**
 * A step a time of tour `id` while `running`, in a popover beside its
 * anchor over a dimmed page. A step whose anchor isn't on screen when
 * reached is dropped. `onEnd` is called when the tour is finished, skipped
 * (Esc too) or runs out of steps, with whether any step was shown; focus then
 * goes back to `origin`, or to where it was when the tour started.
 * `revealPane` opens the workspace sidebar tab holding a step's anchor before the step is shown.
 */
export function Tour({
  id,
  running,
  origin,
  onEnd,
  revealPane,
}: {
  id: TourId;
  running: boolean;
  origin?: HTMLElement | null;
  onEnd: (seen: boolean) => void;
  revealPane?: (pane: TourPane) => void;
}) {
  const [state, setState] = useState<TourState | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  /**
   * The step on screen, with its anchor. It changes once the next step's
   * anchor is found, so the previous step stays up until then.
   */
  const [shown, setShown] = useState<{
    step: TourStep;
    element: HTMLElement;
    number: number;
    count: number;
  } | null>(null);
  /** Where focus goes back to when the tour ends. */
  const returnFocus = useRef<Element | null>(null);
  /** Whether a step was shown since the tour started. */
  const seen = useRef(false);

  function end() {
    setState(null);
    setShown(null);
    onEnd(seen.current);
    // After the popover unmounts: until then its focus trap pulls focus back in.
    const target = returnFocus.current;
    requestAnimationFrame(() => {
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    });
  }
  const endFromEffect = useEffectEvent(end);
  const reveal = useEffectEvent((pane: TourPane) => revealPane?.(pane));
  const startFrom = useEffectEvent(() => origin ?? document.activeElement);

  useEffect(() => {
    if (!running) return;
    returnFocus.current = startFrom();
    seen.current = false;
    setDirection(1);
    setState(startTour(TOURS[id]));
  }, [running, id]);

  // Show the step: open its tab, let it lay out, then find its anchor or drop the step.
  useEffect(() => {
    if (!state) return;
    const step = state.steps[state.index];
    if (!step) return;
    if (step.pane) reveal(step.pane);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const element = findAnchor(step.anchor);
        if (onScreen(element)) {
          seen.current = true;
          setShown({ step, element, number: state.index + 1, count: state.steps.length });
          return;
        }
        const next = dropStep(state, direction);
        if (next) setState(next);
        else endFromEffect();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [state, direction]);

  function move(to: 1 | -1) {
    if (!state) return;
    const next = moveTour(state, to);
    setDirection(to);
    if (next) setState(next);
    else end();
  }

  if (!running || !shown) return null;

  return (
    <>
      <Spotlight element={shown.element} />
      <Popover open modal onOpenChange={(open) => !open && end()}>
        <StepPopover
          key={shown.step.id}
          step={shown.step}
          anchor={shown.element}
          number={shown.number}
          count={shown.count}
          onMove={move}
          onSkip={end}
        />
      </Popover>
    </>
  );
}

/**
 * One step's popover. Keyed by step, so each step moves focus to its Next
 * button and a screen reader announces it.
 */
function StepPopover({
  step,
  anchor,
  number,
  count,
  onMove,
  onSkip,
}: {
  step: TourStep;
  anchor: HTMLElement;
  number: number;
  count: number;
  onMove: (direction: 1 | -1) => void;
  onSkip: () => void;
}) {
  const ids = useId();
  const next = useRef<HTMLButtonElement>(null);
  // Large areas (the viewport) get the popover inside their top edge rather than beside them.
  // `contextElement` lets the positioning watch the anchor itself for moves and resizes.
  const virtualRef = useMemo(
    () => ({
      current: {
        contextElement: anchor,
        getBoundingClientRect: () => {
          const rect = anchor.getBoundingClientRect();
          return step.side === "inside"
            ? new DOMRect(rect.left + rect.width / 2, rect.top + INSIDE_OFFSET, 0, 0)
            : rect;
        },
      },
    }),
    [anchor, step.side],
  );

  const t = useTranslations("Tour");
  return (
    <>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side={step.side === "inside" ? "bottom" : step.side}
        sideOffset={8}
        collisionPadding={8}
        aria-labelledby={`${ids}-count ${ids}-title`}
        aria-describedby={`${ids}-body`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          next.current?.focus();
        }}
        // Focus goes back where it was when the tour ends, not to a trigger.
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="grid gap-2 text-sm"
      >
        <p id={`${ids}-count`} className="text-xs text-muted-foreground tabular-nums">
          {t("count", { number, count })}
        </p>
        <h2 id={`${ids}-title`} className="font-medium">
          {t(`steps.${step.id}.title`)}
        </h2>
        <p id={`${ids}-body`} className="text-muted-foreground">
          {t(`steps.${step.id}.body`)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={onSkip}>
            {t("skip")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={number === 1}
            onClick={() => onMove(-1)}
          >
            {t("back")}
          </Button>
          <Button ref={next} size="sm" onClick={() => onMove(1)}>
            {number === count ? t("done") : t("next")}
          </Button>
        </div>
      </PopoverContent>
    </>
  );
}

/** How far below the top of a large anchor its popover sits, in pixels. */
const INSIDE_OFFSET = 16;

/** How far the highlight extends past its element, in pixels. */
const SPOTLIGHT_PADDING = 4;

/**
 * Dims the page around `element`. It is measured again when the element or
 * the page resizes, or anything scrolls; while the tour is up, those are the
 * only ways it can move.
 */
function Spotlight({ element }: { element: HTMLElement }) {
  const [rect, setRect] = useState(() => element.getBoundingClientRect());

  useEffect(() => {
    let frame = 0;
    function measure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(element.getBoundingClientRect()));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(document.documentElement);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, { capture: true });
    };
  }, [element]);

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 rounded-md shadow-[0_0_0_2px_var(--ring),0_0_0_9999px_rgb(0_0_0/0.45)] transition-[top,left,width,height] duration-150"
      style={{
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + 2 * SPOTLIGHT_PADDING,
        height: rect.height + 2 * SPOTLIGHT_PADDING,
      }}
    />,
    document.body,
  );
}
