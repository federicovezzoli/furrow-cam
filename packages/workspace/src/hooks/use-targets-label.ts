import type { OperationTarget } from "@furrow/document";
import { useTranslations } from "use-intl";
import { selectionCounts } from "../lib/path-selection";

/**
 * Says how many shapes and paths targets cut, e.g. "2 selected shapes",
 * "3 selected paths" or "1 selected shape and 2 paths".
 */
export function useTargetsLabel() {
  const t = useTranslations("Selection");
  return (targets: OperationTarget[]) => {
    const { shapes, paths } = selectionCounts(targets);
    if (paths === 0) return t("shapes", { count: shapes });
    if (shapes === 0) return t("paths", { count: paths });
    return t("both", { shapes, paths });
  };
}
