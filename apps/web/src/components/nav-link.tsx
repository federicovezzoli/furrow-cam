"use client";

import { cn } from "@furrow/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

/** A navbar link, highlighted while its section is the current page. */
export function NavLink({ href, ...props }: React.ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1 transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      {...props}
    />
  );
}
