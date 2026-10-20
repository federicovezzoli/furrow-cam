/**
 * Bug reports as prefilled GitHub issue drafts: the app sends nothing itself,
 * the user reviews the draft and submits it on GitHub (ADR-0013). Plain
 * module, so the desktop app's main process can use it too.
 */

import type { ProjectDocument } from "@furrow/document";

export const NEW_ISSUE_URL = "https://github.com/federicovezzoli/furrow-cam/issues/new";

/** GitHub refuses much longer draft URLs; past this the body goes by clipboard instead. */
export const MAX_REPORT_URL_LENGTH = 6000;

export const PASTE_PROMPT =
  "<!-- Furrow CAM copied the report to your clipboard: paste it here, replacing this line. -->";

export const SCREENSHOT_PROMPT =
  "<!-- Paste or drop the screenshot from Furrow CAM here: GitHub can't receive it from the app. -->";

/** What the report says about the app and the project, in order: a label and its value. */
export type Diagnostics = [label: string, value: string][];

/**
 * The issue body: the user's `description`, a place to paste the screenshot
 * when there is one, then the diagnostics. One-line values are a list; longer
 * ones (e.g. an operation's parameters) a JSON block.
 */
export function reportBody(
  description: string,
  diagnostics: Diagnostics,
  screenshot = false,
): string {
  const short = diagnostics.filter(([, value]) => !value.includes("\n"));
  const long = diagnostics.filter(([, value]) => value.includes("\n"));
  return [
    "### What happened",
    "",
    description.trim() || "<!-- What did you do, what happened, and what did you expect? -->",
    "",
    ...(screenshot ? ["### Screenshot", "", SCREENSHOT_PROMPT, ""] : []),
    "### Diagnostics",
    "",
    ...short.map(([label, value]) => `- ${label}: ${value}`),
    ...long.flatMap(([label, value]) => ["", `${label}:`, "", "```json", value, "```"]),
  ].join("\n");
}

/**
 * The draft's URL. `fits` is `false` when `body` would make it too long: the
 * draft then only asks to paste the report, which the caller copies.
 */
export function reportUrl(title: string, body: string): { url: string; fits: boolean } {
  const url = (text: string) =>
    `${NEW_ISSUE_URL}?${new URLSearchParams({ labels: "bug", title, body: text })}`;
  const full = url(body);
  return full.length <= MAX_REPORT_URL_LENGTH
    ? { url: full, fits: true }
    : { url: url(PASTE_PROMPT), fits: false };
}

/** The draft for a report with no description, as the footers and the Help menu open it. */
export function blankReportUrl(diagnostics: Diagnostics): string {
  return reportUrl("", reportBody("", diagnostics)).url;
}

/**
 * What the report says about the project: the document's version and units,
 * the machine, and the operation `operationId` without its name and targets.
 * No project name and no geometry.
 */
export function projectDiagnostics(
  document: ProjectDocument,
  operationId: string | null,
): Diagnostics {
  const { machine } = document;
  const diagnostics: Diagnostics = [
    ["Document schema", String(document.schemaVersion)],
    ["Units", document.units],
    ["Machine", machine ? `${machine.name} (${machine.postProcessor})` : "none"],
  ];
  const operation = document.operations.find(({ id }) => id === operationId);
  if (operation) {
    const { id: _, name: __, targets, ...settings } = operation;
    const summary = { ...settings, targets: targets.length };
    diagnostics.push(["Selected operation", JSON.stringify(summary, null, 2)]);
  }
  return diagnostics;
}
