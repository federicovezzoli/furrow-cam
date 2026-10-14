/** A column's unit, under its heading. */
export function Unit({ children }: { children: string }) {
  return <span className="block text-xs font-normal text-muted-foreground">{children}</span>;
}

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** A number for a table cell, with at most two decimals. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}
