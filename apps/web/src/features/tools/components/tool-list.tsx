import { Tool } from "@furrow/document";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@furrow/ui/components/ui/table";
import type { Translator } from "@furrow/ui/lib/i18n";
import { BitTypeIcon } from "@furrow/workspace/tools/components/bit-type-icon";
import { CUT_DIRECTION_LABELS, TOOL_TYPE_LABELS } from "@furrow/workspace/tools/lib/labels";
import { PencilIcon } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";
import { numberFormatter, Unit } from "@/components/table-format";
import { deleteTool } from "@/features/tools/actions";
import type { Tool as ToolRow } from "@/generated/prisma/client";
import { getLocale, getTranslator } from "@/lib/locale";
import { OpenToolButton } from "./library-dialog";
import { SetDefaultButton } from "./set-default-button";

/** The row's fields the bit form edits: the `Tool` schema's, leaving out ids and timestamps. */
function toolValues(row: ToolRow): Partial<Tool> {
  return Object.fromEntries(Tool.keyof().options.map((key) => [key, row[key]]));
}

export async function ToolList({ tools }: { tools: ToolRow[] }) {
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const formatNumber = numberFormatter(locale);
  if (tools.length === 0) {
    return <p className="rounded-lg border p-4 text-muted-foreground">{t("Tools.empty")}</p>;
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="[&>th]:h-auto [&>th]:py-2 [&>th]:align-bottom">
            <TableHead className="w-0 pl-2">
              <span className="sr-only">{t("Tools.default")}</span>
            </TableHead>
            <TableHead>{t("Tools.name")}</TableHead>
            <TableHead>{t("Tools.type")}</TableHead>
            <TableHead className="text-right">
              Ø<Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">{t("Tools.flutes")}</TableHead>
            <TableHead className="text-right">
              {t("Tools.fluteLength")}
              <Unit>mm</Unit>
            </TableHead>
            <TableHead>{t("Tools.cutAngle")}</TableHead>
            <TableHead className="text-right">
              {t("Tools.spindle")}
              <Unit>RPM</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Tools.feed")}
              <Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Tools.plunge")}
              <Unit>mm/min</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Tools.plungeAngle")}
              <Unit>°</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Tools.stepDown")}
              <Unit>mm</Unit>
            </TableHead>
            <TableHead className="text-right">
              {t("Tools.stepOver")}
              <Unit>mm</Unit>
            </TableHead>
            <TableHead className="pr-4">
              <span className="sr-only">{t("Tools.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {tools.map((tool) => {
            const values = toolValues(tool);
            return (
              <TableRow key={tool.id}>
                <TableCell className="pl-2">
                  <SetDefaultButton id={tool.id} name={tool.name} isDefault={tool.isDefault} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-3 shrink-0 border"
                      style={{ backgroundColor: tool.color }}
                      aria-hidden="true"
                    />
                    <OpenToolButton
                      id={tool.id}
                      values={values}
                      variant="link"
                      className="h-auto p-0 font-medium text-foreground"
                    >
                      {tool.name}
                    </OpenToolButton>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <BitTypeIcon type={tool.type} className="h-7 w-3.5 text-muted-foreground" />
                    {TOOL_TYPE_LABELS[tool.type]}
                  </div>
                </TableCell>
                <TableCell className="text-right">{formatNumber(tool.diameter)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.fluteCount)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.fluteLength)}</TableCell>
                <TableCell>{describeCut(tool, formatNumber, t)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.spindleRpm)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.feedRate)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.plungeRate)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.plungeAngle)}</TableCell>
                <TableCell className="text-right">{formatNumber(tool.stepDown)}</TableCell>
                <TableCell className="text-right">
                  {formatNumber((tool.diameter * tool.stepOver) / 100)}{" "}
                  <span className="text-muted-foreground">({formatNumber(tool.stepOver)}%)</span>
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex justify-end gap-1">
                    <OpenToolButton
                      id={tool.id}
                      values={values}
                      variant="ghost"
                      size="icon-sm"
                      title={t("Tools.edit")}
                      aria-label={t("Tools.editLabel", { name: tool.name })}
                    >
                      <PencilIcon />
                    </OpenToolButton>
                    <DeleteButton
                      name={tool.name}
                      // Projects keep their own snapshot of the tool, so deleting it is safe (ADR-0003).
                      confirmText={t("Tools.deleteConfirm", { name: tool.name })}
                      action={deleteTool.bind(null, tool.id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Cut direction for end mills, angle and tip for V-bits, nothing for drills. */
function describeCut(tool: Tool, formatNumber: (value: number) => string, t: Translator): string {
  if (tool.cutDirection) return CUT_DIRECTION_LABELS[tool.cutDirection];
  if (tool.vAngle === null) return "—";
  const tip = tool.tipDiameter
    ? ` · ${t("Tools.tip", { size: formatNumber(tool.tipDiameter) })}`
    : "";
  return `${formatNumber(tool.vAngle)}°${tip}`;
}
