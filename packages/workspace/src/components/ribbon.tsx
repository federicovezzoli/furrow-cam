"use client";

import { Button } from "@furrow/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@furrow/ui/components/ui/tooltip";
import { cn } from "@furrow/ui/lib/utils";
import type * as React from "react";

/**
 * The workspace's ribbon under the top bar: groups of commands, each with a
 * caption under it. Narrow ribbons drop the captions, then the buttons'
 * labels, and scroll sideways only below that.
 */
export function Ribbon({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container shrink-0 overflow-x-auto border-b">
      <div className="flex w-max items-stretch px-1 py-1">{children}</div>
    </div>
  );
}

/** A group of ribbon commands with its `caption`; `tour` is its `data-tour` anchor. */
export function RibbonGroup({
  caption,
  tour,
  children,
}: {
  caption: string;
  tour?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      aria-label={caption}
      data-tour={tour}
      className="flex min-w-0 flex-col items-center gap-0.5 border-r px-1 last:border-r-0"
    >
      <div className="flex flex-1 items-start gap-0.5">{children}</div>
      <span aria-hidden className="hidden text-[0.625rem]/3 text-muted-foreground @[40rem]:block">
        {caption}
      </span>
    </fieldset>
  );
}

/**
 * A ribbon command: its `icon` over its `label`. The tooltip shows
 * `disabledReason` when given, else `hint`, else the label. Disabled with
 * `aria-disabled` rather than `disabled`, so it stays focusable and keyboard
 * users can read why.
 */
export function RibbonButton({
  icon,
  label,
  hint,
  disabledReason,
  onClick,
  className,
  ...props
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  disabledReason?: string;
} & React.ComponentProps<typeof Button>) {
  const disabled = disabledReason !== undefined;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
            className={cn(
              // One size for every command, so the ribbon reads as a grid; long labels truncate.
              "size-11 flex-col justify-start gap-1 px-1.5 py-3 font-normal text-[0.625rem]/3 has-[>svg]:px-1.5 @[30rem]:h-12 @[30rem]:w-20 @[30rem]:py-1.5 [&_svg:not([class*='size-'])]:size-5",
              // Disabled doesn't light up on hover, so it doesn't suggest it works.
              "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent dark:aria-disabled:hover:bg-transparent",
              className,
            )}
            // Named by its label even when narrow ribbons hide it.
            aria-label={label}
            {...props}
          >
            {icon}
            <span className="hidden w-full truncate text-center @[30rem]:block">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{disabledReason ?? hint ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
