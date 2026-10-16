"use client";

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { finishTour } from "@/features/onboarding/actions";
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
} from "@/features/onboarding/lib/tour";

/**
 * Tours finished or skipped since the page loaded: the server's timestamps
 * only come back on the next load, so this keeps a tour from starting again
 * on a client-side navigation.
 */
const finished = new Set<TourId>();

/**
 * Whether tour `id` is running, starting it on mount when `autoStart` holds
 * and the account hasn't finished it (`done`). `end` stops it and, the first
 * time, stores on the account that it was seen, without waiting for the save.
 */
export function useTour(id: TourId, { done, autoStart }: { done: boolean; autoStart: boolean }) {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (autoStart && !done && !finished.has(id)) setRunning(true);
  }, [id, done, autoStart]);

  const start = useCallback(() => setRunning(true), []);
  const end = useCallback(() => {
    setRunning(false);
    if (done || finished.has(id)) return;
    finished.add(id);
    finishTour(id).catch((error: unknown) => {
      console.error(`Failed to remember that the ${id} tour was seen`, error);
    });
  }, [id, done]);

  return { running, start, end };
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
 * anchor over a dimmed page; `onEnd` is called when it is finished, skipped
 * (Esc too) or has no step on screen. `revealPane` expands a collapsed
 * workspace pane before its step is shown.
 */
export function Tour({
  id,
  running,
  onEnd,
  revealPane,
}: {
  id: TourId;
  running: boolean;
  onEnd: () => void;
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
  /** Where focus was when the tour started, to give it back. */
  const returnFocus = useRef<Element | null>(null);

  function end() {
    setState(null);
    setShown(null);
    onEnd();
    // After the popover unmounts: until then its focus trap pulls focus back in.
    const target = returnFocus.current;
    requestAnimationFrame(() => {
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    });
  }
  const endFromEffect = useEffectEvent(end);
  const reveal = useEffectEvent((pane: TourPane) => revealPane?.(pane));

  // Start with the steps on screen; a step inside a pane needs only the pane, which it expands.
  useEffect(() => {
    if (!running) return;
    const frame = requestAnimationFrame(() => {
      returnFocus.current = document.activeElement;
      const tour = startTour(TOURS[id], (step) => onScreen(findAnchor(step.pane ?? step.anchor)));
      setDirection(1);
      if (tour) setState(tour);
      else endFromEffect();
    });
    return () => cancelAnimationFrame(frame);
  }, [running, id]);

  // Show the step: expand its pane, let it lay out, then find its anchor or drop the step.
  useEffect(() => {
    if (!state) return;
    const step = state.steps[state.index];
    if (step.pane) reveal(step.pane);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const element = findAnchor(step.anchor);
        if (onScreen(element)) {
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
  const virtualRef = useMemo(
    () => ({
      current: {
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

  return (
    <>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side={step.side === "inside" ? "bottom" : step.side}
        sideOffset={8}
        collisionPadding={8}
        // Panes resize while the tour expands them: follow the anchor every frame.
        updatePositionStrategy="always"
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
          Step {number} of {count}
        </p>
        <h2 id={`${ids}-title`} className="font-medium">
          {step.title}
        </h2>
        <p id={`${ids}-body`} className="text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={onSkip}>
            Skip tour
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={number === 1}
            onClick={() => onMove(-1)}
          >
            Back
          </Button>
          <Button ref={next} size="sm" onClick={() => onMove(1)}>
            {number === count ? "Done" : "Next"}
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

/** Dims the page around `element`, following it as it moves or resizes. */
function Spotlight({ element }: { element: HTMLElement }) {
  const [rect, setRect] = useState(() => element.getBoundingClientRect());

  useEffect(() => {
    let frame = 0;
    function track() {
      const next = element.getBoundingClientRect();
      setRect((last) =>
        last.top === next.top &&
        last.left === next.left &&
        last.width === next.width &&
        last.height === next.height
          ? last
          : next,
      );
      frame = requestAnimationFrame(track);
    }
    track();
    return () => cancelAnimationFrame(frame);
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
