import { cn } from "../lib/utils";

/**
 * The mark, as furrow.cam shows it: an F as a round end mill would carve it.
 * The middle pass is still being cut, so its tip is the tool, in the "cut"
 * orange (`ring`).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-5 shrink-0", className)}>
      <path
        d="M6 20V4h12M6 13h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="13" r="2" className="fill-ring" />
    </svg>
  );
}
