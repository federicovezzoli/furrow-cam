import type { ToolType } from "@furrow/document";
import { cn } from "cn";
import type { ReactNode } from "react";

/** Side profile of each bit type: shank at the top, cutting end at the bottom. */
const PROFILES: Record<ToolType, ReactNode> = {
  flat_end_mill: (
    <>
      <rect x="9" y="2" width="6" height="18" rx="1" />
      <path d="M7 20h10v24H7z" />
      <path d="M7 23l10 6M7 30l10 6M7 37l10 6" />
    </>
  ),
  ball_end_mill: (
    <>
      <rect x="9" y="2" width="6" height="18" rx="1" />
      <path d="M7 20h10v19a5 5 0 0 1-10 0z" />
      <path d="M7 23l10 6M7 30l10 6" />
    </>
  ),
  v_bit: (
    <>
      <rect x="9" y="2" width="6" height="22" rx="1" />
      <path d="M5 24h14l-7 20z" />
      <path d="M12 24v20" />
    </>
  ),
  drill: (
    <>
      <rect x="9.5" y="2" width="5" height="16" rx="1" />
      <path d="M9 18h6v22l-3 5-3-5z" />
      <path d="M9 21l6 4M9 27l6 4M9 33l6 4" />
    </>
  ),
};

export function BitTypeIcon({ type, className }: { type: ToolType; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={cn("h-8 w-4 shrink-0", className)}
      aria-hidden="true"
    >
      {PROFILES[type]}
    </svg>
  );
}
