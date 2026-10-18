import type { Operation } from "@furrow/document";
import { cn } from "@furrow/ui/lib/utils";
import type { ReactNode } from "react";

/**
 * Top view of each operation: the shape it cuts drawn faint, the toolpath drawn solid.
 * Profile loops around the shape, pocket clears inside it, drill plunges on its centre,
 * engrave traces the line itself, V-carve runs down the middle of the shape into its corners,
 * 3D finishing zig-zags over the model, 3D roughing steps down around it in levels.
 */
const PATHS: Record<Operation["type"], ReactNode> = {
  profile: (
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="0.5" opacity="0.45" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    </>
  ),
  pocket: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="0.5" opacity="0.45" />
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" />
    </>
  ),
  drill: (
    <>
      <circle cx="12" cy="12" r="6" opacity="0.45" />
      <path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  engrave: (
    <>
      <path d="M3 18c2.5-9 5.5-12 8-7s5.5 6 10-6" />
      <circle cx="21" cy="5" r="1.5" fill="currentColor" />
    </>
  ),
  vcarve: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="0.5" opacity="0.45" />
      <path d="M3 7l5 5-5 5M21 7l-5 5 5 5M8 12h8" />
    </>
  ),
  relief_finish: (
    <>
      <circle cx="12" cy="12" r="7" opacity="0.45" />
      <path d="M4 5h16v4.67H4v4.66h16V19H4" />
    </>
  ),
  relief_rough: (
    <>
      <circle cx="12" cy="12" r="7" opacity="0.45" />
      <path d="M3 20h4v-5h3v-5h4v5h3v5h4" />
    </>
  ),
};

export function OperationTypeIcon({
  type,
  className,
}: {
  type: Operation["type"];
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={cn("size-5 shrink-0", className)}
      aria-hidden="true"
    >
      {PATHS[type]}
    </svg>
  );
}
