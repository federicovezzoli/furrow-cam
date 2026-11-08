import { formatQuantity, unitLabel } from "@furrow/cam-core";
import type { Machine, Units } from "@furrow/document";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@furrow/ui/components/ui/alert-dialog";
import { localizeDecimal } from "@furrow/ui/lib/locales";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import type { MachineChoice } from "../lib/workspace-host";
import { POST_PROCESSOR_LABELS } from "../machines/lib/labels";
import { useWorkspaceHost } from "../providers/workspace-host";
import { useDocumentStoreApi } from "../providers/workspace-stores";
import { changedMachineFields, outdatedMachineChoice, setMachine } from "../stores/machine-actions";

/** Projects already asked about in this session, by id: Keep is not remembered beyond it (#512). */
const asked = new Set<string>();

/** Each profile field's label in the machine form ("Machine" messages). */
const LABELS = {
  name: "name",
  workAreaX: "xTravel",
  workAreaY: "yTravel",
  workAreaZ: "zTravel",
  maxFeedXY: "maxFeedXY",
  maxFeedZ: "maxFeedZ",
  accelerationXY: "accelerationXY",
  accelerationZ: "accelerationZ",
  spindleRpmMin: "minSpeed",
  spindleRpmMax: "maxSpeed",
  spinUpDelay: "spinUpDelay",
  safeZ: "safeZ",
  entryClearance: "entryClearance",
  postProcessor: "postProcessor",
  programStart: "blocks.programStart",
  programEnd: "blocks.programEnd",
  operationStart: "blocks.operationStart",
  toolChange: "blocks.toolChange",
} as const satisfies Record<keyof Machine, string>;

/** `machine[key]` as text, in `units` and `locale`; `null` (unset) as a dash. */
function formatField(machine: Machine, key: keyof Machine, units: Units, locale: string): string {
  const value = machine[key];
  if (value === null) return "–";
  if (typeof value === "string") {
    return key === "postProcessor" ? POST_PROCESSOR_LABELS[machine.postProcessor] : value;
  }
  const decimal = (text: string) => localizeDecimal(text, locale);
  switch (key) {
    case "maxFeedXY":
    case "maxFeedZ":
      return `${decimal(formatQuantity(value, "feed", units))} ${unitLabel("feed", units)}`;
    case "accelerationXY":
    case "accelerationZ":
      return `${decimal(String(value))} mm/s²`;
    case "spindleRpmMin":
    case "spindleRpmMax":
      return `${decimal(String(value))} RPM`;
    case "spinUpDelay":
      return `${decimal(String(value))} s`;
    default:
      return `${decimal(formatQuantity(value, "length", units))} ${unitLabel("length", units)}`;
  }
}

/**
 * Offers, when the project opens, to update its machine snapshot to the
 * library machine it came from, if that has been edited since (ADR-0079).
 * Asks at most once per project per session; keeping the copy changes nothing.
 */
export function MachineUpdateDialog({ machines }: { machines: MachineChoice[] }) {
  const t = useTranslations("Stock");
  const labels = useTranslations("Machine");
  const locale = useLocale();
  const { project } = useWorkspaceHost();
  const store = useDocumentStoreApi();
  // Read once, on open: later edits don't bring the dialog up, nor change it while it fades out.
  const [{ choice, document }] = useState(() => {
    const document = store.getState().document;
    const choice = asked.has(project.id) ? undefined : outdatedMachineChoice(machines, document);
    return { choice, document };
  });
  const [open, setOpen] = useState(choice !== undefined);
  useEffect(() => {
    if (choice) asked.add(project.id);
  }, [choice, project.id]);

  const { machine, units } = document;
  if (!choice || !machine) return null;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("machineChanged", { name: machine.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("machineChangedHint")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-1 text-sm">
          {changedMachineFields(machine, choice.machine).map((key) => (
            <li key={key}>
              <span className="font-medium">{labels(LABELS[key])}</span>
              {LABELS[key].startsWith("blocks.") ? (
                <span className="text-muted-foreground"> {t("gcodeChanged")}</span>
              ) : (
                <>
                  : {formatField(machine, key, units, locale)} →{" "}
                  {formatField(choice.machine, key, units, locale)}
                </>
              )}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keepMachine")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => setMachine(store, choice.machine, choice.id)}>
            {t("updateMachine")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
