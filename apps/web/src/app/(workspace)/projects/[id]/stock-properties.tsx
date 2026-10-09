"use client";

import { type Stock, Units } from "@furrow/document";
import { NumberField } from "@/components/number-field";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useDocumentStore, useDocumentStoreApi } from "@/stores/workspace-stores";

const UNIT_LABELS: Record<Units, string> = { mm: "Millimetres", in: "Inches" };

const DIMENSIONS = [
  ["width", "Width"],
  ["height", "Height"],
  ["thickness", "Thickness"],
] as const satisfies [keyof Stock, string][];

/** Thinner than any stock worth cutting, and keeps the stock's sizes positive. */
const MIN_STOCK = 0.1;

/** The project's display units and stock size, shown while nothing is selected. */
export function StockProperties() {
  const store = useDocumentStoreApi();
  const units = useDocumentStore((s) => s.document.units);
  const stock = useDocumentStore((s) => s.document.stock);

  return (
    <div className="grid gap-4 p-3 text-ui">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-x-2">
        <Label htmlFor="units" className="text-ui font-normal">
          Units
        </Label>
        <NativeSelect
          id="units"
          size="sm"
          value={units}
          onChange={(event) => {
            const next = Units.parse(event.target.value);
            store.getState().change("setUnits", (draft) => {
              draft.units = next;
            });
          }}
          className="h-control px-2 pr-7 text-ui"
        >
          {Units.options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {UNIT_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <section aria-labelledby="stock-heading" className="grid gap-2">
        <h3 id="stock-heading" className="font-medium">
          Stock
        </h3>
        {DIMENSIONS.map(([key, label]) => (
          <NumberField
            key={key}
            id={`stock-${key}`}
            label={label}
            layout="inline"
            quantity="length"
            units={units}
            min={MIN_STOCK}
            value={stock[key]}
            onValueChange={(value) =>
              store.getState().change(`setStock.${key}`, (draft) => {
                draft.stock[key] = value;
              })
            }
            onGestureStart={() => store.getState().beginTransaction()}
            onGestureEnd={(cancelled) => {
              const state = store.getState();
              if (cancelled) state.cancelTransaction();
              else state.commitTransaction();
            }}
          />
        ))}
      </section>
    </div>
  );
}
