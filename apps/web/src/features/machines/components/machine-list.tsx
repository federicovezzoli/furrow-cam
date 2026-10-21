import { Button } from "@furrow/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@furrow/ui/components/ui/table";
import { POST_PROCESSOR_LABELS } from "@furrow/workspace/machines/lib/labels";
import { PencilIcon } from "lucide-react";
import Link from "next/link";
import { DeleteButton } from "@/components/delete-button";
import { numberFormatter, Unit } from "@/components/table-format";
import { deleteMachine } from "@/features/machines/actions";
import type { Machine as MachineRow } from "@/generated/prisma/client";
import { getLocale, getTranslator } from "@/lib/locale";

export async function MachineList({ machines }: { machines: MachineRow[] }) {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const formatNumber = numberFormatter(locale);
  if (machines.length === 0) {
    return <p className="rounded-lg border p-4 text-muted-foreground">{t("Machines.empty")}</p>;
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="[&>th]:h-auto [&>th]:py-2 [&>th]:align-bottom">
            <TableHead className="pl-4">{t("Machines.name")}</TableHead>
            <TableHead className="text-right">
              {t("Machines.workArea")}
              <Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Machines.maxFeedXY")}
              <Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Machines.maxFeedZ")}
              <Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Machines.spindle")}
              <Unit>RPM</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Machines.safeZ")}
              <Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Machines.entryClearance")}
              <Unit>mm</Unit>
            </TableHead>
            <TableHead>{t("Machines.postProcessor")}</TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">{t("Machines.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {machines.map((machine) => (
            <TableRow key={machine.id}>
              <TableCell className="pl-4">
                <Link href={`/machines/${machine.id}`} className="font-medium hover:underline">
                  {machine.name}
                </Link>
              </TableCell>
              <TableCell className="text-right">
                {[machine.workAreaX, machine.workAreaY, machine.workAreaZ]
                  .map(formatNumber)
                  .join(" × ")}
              </TableCell>
              <TableCell className="text-right">{formatNumber(machine.maxFeedXY)}</TableCell>
              <TableCell className="text-right">{formatNumber(machine.maxFeedZ)}</TableCell>
              <TableCell className="text-right">
                {machine.spindleRpmMin === null || machine.spindleRpmMax === null
                  ? t("Machines.manual")
                  : `${formatNumber(machine.spindleRpmMin)}–${formatNumber(machine.spindleRpmMax)}`}
              </TableCell>
              <TableCell className="text-right">{formatNumber(machine.safeZ)}</TableCell>
              <TableCell className="text-right">{formatNumber(machine.entryClearance)}</TableCell>
              <TableCell>{POST_PROCESSOR_LABELS[machine.postProcessor]}</TableCell>
              <TableCell className="pr-4">
                <div className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon-sm" title={t("Machines.edit")}>
                    <Link
                      href={`/machines/${machine.id}`}
                      aria-label={t("Machines.editLabel", { name: machine.name })}
                    >
                      <PencilIcon />
                    </Link>
                  </Button>
                  <DeleteButton
                    name={machine.name}
                    // Projects keep their own snapshot of the machine, so deleting it is safe (ADR-0003).
                    confirmText={t("Machines.deleteConfirm", { name: machine.name })}
                    action={deleteMachine.bind(null, machine.id)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
