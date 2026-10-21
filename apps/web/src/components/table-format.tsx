import type { Locale } from "@furrow/ui/lib/locales";

/** A column's unit, under its heading. */
export function Unit({ children }: { children: string }) {
  return <span className="block text-xs font-normal text-muted-foreground">{children}</span>;
}

/** Formats numbers for table cells in `locale`, with at most two decimals. */
export function numberFormatter(locale: Locale): (value: number) => string {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (value) => format.format(value);
}
