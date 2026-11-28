"use client";

import { moveStartDistance, type PlaybackPath, playbackPosition } from "@furrow/cam-core";
import type { CustomBlock } from "@furrow/post";
import { cn } from "@furrow/ui/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { useStore } from "zustand";
import type { usePlayback } from "../../hooks/use-playback";
import { firstMoveOfLine, lineOfMove } from "../../lib/playback-moves";
import type { PlaybackStore } from "../../stores/playback-store";

/** The height of a line of the program, in pixels: rows are fixed so only those in view are drawn. */
const ROW = 20;
/** Lines drawn beyond the view each way, so scrolling doesn't show blanks. */
const OVERSCAN = 20;
/** The view's height before it is measured, e.g. in tests. */
const UNMEASURED = 800;
/** Browsers cut taller boxes short (Firefox at about 17.9 million px), so longer programs scroll by ratio. */
const MAX_HEIGHT = 10_000_000;

/**
 * How `count` lines scroll in a view `view` px tall: in a box `height` px
 * tall, at most `MAX_HEIGHT`, where scrolling 1 px moves `ratio` px down the
 * program, so its last line can still be reached.
 */
export function programScroll(count: number, view: number): { height: number; ratio: number } {
  const full = count * ROW;
  const height = Math.min(full, MAX_HEIGHT);
  return { height, ratio: full > height && height > view ? (full - view) / (height - view) : 1 };
}

type Program = NonNullable<ReturnType<typeof usePlayback>["program"]>;

/**
 * The program played (#684, PRD-0006 P4–P6), as Export saves it, with line
 * numbers: the line the playback is on highlighted and kept in view, the
 * machine's custom blocks marked, and the warnings of reading it back, each
 * linked to its line. Clicking a line that moves the tool seeks to its first
 * move. Only the lines in view are drawn, so a relief's program scrolls smoothly.
 */
export function ProgramPanel({
  store,
  path,
  program,
}: {
  store: PlaybackStore;
  path: PlaybackPath | null;
  program: Program;
}) {
  const t = useTranslations("Viewport");
  const { gcode, blocks, moveLines, warnings, failure } = program;
  const text = useMemo(() => gcode.replace(/\n$/, "").split("\n"), [gcode]);
  const current = useStore(store, (s) => {
    const at = path && playbackPosition(path, s.distance);
    return at ? lineOfMove(moveLines, at.move) : null;
  });
  const view = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(UNMEASURED);
  const { height: boxHeight, ratio } = programScroll(text.length, height);
  /** How far down the program the view is, in px of `ROW` per line. */
  const offset = scroll * ratio;

  useEffect(() => {
    const element = view.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight || UNMEASURED));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The line played stays in view, as the playback plays or is scrubbed.
  useEffect(() => {
    const element = view.current;
    if (!element || current === null) return;
    const top = (current - 1) * ROW;
    const shown = element.scrollTop * ratio;
    if (top < shown || top + ROW > shown + element.clientHeight) {
      // The scroll event comes a frame later, and lines played meanwhile would be blank.
      setScroll(scrollToLine(element, current, ratio));
    }
  }, [current, ratio]);

  function seek(line: number) {
    if (!path) return;
    const move = firstMoveOfLine(moveLines, path, line);
    if (move !== null) store.getState().setDistance(moveStartDistance(path, move));
  }

  /** Shows line `line` and, if it moves the tool, plays from there. */
  function goTo(line: number) {
    const element = view.current;
    if (element) setScroll(scrollToLine(element, line, ratio));
    seek(line);
  }

  const first = Math.max(Math.floor(offset / ROW) - OVERSCAN, 0);
  const last = Math.min(Math.ceil((offset + height) / ROW) + OVERSCAN, text.length);
  const warned = useMemo(
    () => new Set(warnings.filter((w) => w.side === undefined).map((w) => w.line)),
    [warnings],
  );
  const linked = [
    ...(failure && "line" in failure
      ? [
          {
            // The top side's program isn't the one shown here.
            line: failure.side === undefined ? failure.line : null,
            text: t("programUnreadable", { ...failure, side: failure.side ?? "shown" }),
          },
        ]
      : []),
    ...warnings.map((warning) => ({
      // The top side's warnings are about a program not shown here.
      line: warning.side === undefined ? warning.line : null,
      text: t("programWarning", { ...warning, side: warning.side ?? "shown" }),
    })),
  ];

  return (
    <aside
      aria-label={t("program")}
      className="flex min-h-0 w-80 shrink-0 flex-col border-l bg-background"
      data-demo="program"
    >
      <div
        ref={view}
        className="min-h-0 flex-1 overflow-auto font-mono text-xs"
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      >
        <div className="relative" style={{ height: boxHeight }}>
          {text.slice(first, last).map((code, i) => {
            const line = first + i + 1;
            const block = blockAt(blocks, line);
            const moves = path !== null && firstMoveOfLine(moveLines, path, line) !== null;
            const Row = moves ? "button" : "div";
            return (
              <Row
                key={line}
                type={moves ? "button" : undefined}
                aria-current={line === current ? "true" : undefined}
                title={block ? t("programBlock", { block: block.label }) : undefined}
                onClick={moves ? () => seek(line) : undefined}
                className={cn(
                  "absolute inset-x-0 flex w-max min-w-full items-center gap-3 whitespace-pre pr-2 text-left",
                  block ? "border-muted-foreground/40 border-l-2" : "border-transparent border-l-2",
                  moves && "cursor-pointer hover:bg-muted",
                  line === current && "bg-primary/15 hover:bg-primary/20",
                )}
                style={{ top: (line - 1) * ROW - offset + scroll, height: ROW }}
              >
                <span
                  className={cn(
                    "w-12 shrink-0 select-none text-right text-muted-foreground tabular-nums",
                    warned.has(line) && "text-amber-600 dark:text-amber-500",
                  )}
                >
                  {line}
                </span>
                <span>{code}</span>
              </Row>
            );
          })}
        </div>
      </div>
      {linked.length > 0 && (
        <ul
          aria-label={t("programWarnings")}
          className="max-h-32 shrink-0 overflow-auto border-t p-1 text-ui"
        >
          {linked.map(({ line, text }, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: warnings may repeat, and their order is fixed
            <li key={i}>
              {line === null ? (
                <p className="px-1 py-0.5 text-muted-foreground">{text}</p>
              ) : (
                <button
                  type="button"
                  className="w-full rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => goTo(line)}
                >
                  {text}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** Scrolls `element` to show line `line` a third of the way down (`programScroll`); where it scrolled to. */
function scrollToLine(element: HTMLElement, line: number, ratio: number): number {
  element.scrollTop = Math.max((line - 1) * ROW - element.clientHeight / 3, 0) / ratio;
  return element.scrollTop;
}

/** The custom block line `line` is in, if any. */
function blockAt(blocks: readonly CustomBlock[], line: number): CustomBlock | undefined {
  return blocks.find((block) => block.first <= line && line <= block.last);
}
