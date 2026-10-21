/**
 * A message for the user from a core package (ADR-0054): a code the UI
 * translates, with the values it shows. The core packages build no English;
 * each lists its codes, so a test can check every one is translated.
 */
export type Message<Code extends string = string> = {
  readonly code: Code;
  readonly values?: Readonly<Record<string, string | number>>;
};

/**
 * The document package's codes: Zod issue messages (a schema's custom
 * issues and limits carry a code as their message) and archive and
 * migration errors.
 */
export const DOCUMENT_MESSAGES = [
  "validation.required",
  "validation.invalid",
  "validation.notANumber",
  "validation.wholeNumber",
  "validation.atLeast",
  "validation.greaterThan",
  "validation.atMost",
  "validation.lessThan",
  "validation.minCharacters",
  "validation.choose",
  "validation.multipleOf",
  "validation.blank",
  "validation.colour",
  "validation.sha256",
  "validation.maxCharacters",
  "validation.maxSeconds",
  "validation.maxRpm",
  "tool.cutDirectionRequired",
  "tool.cutDirectionEndMillsOnly",
  "tool.vBitRequired",
  "tool.vBitOnly",
  "tool.drillPlunge90",
  "tool.exceedsFluteLength",
  "tool.smallerThanDiameter",
  "machine.belowZTravel",
  "machine.atMostSafeZ",
  "machine.spindleBoth",
  "machine.spindleMinMax",
  "model.cornerOrder",
  "geometry.zeroLine",
  "geometry.zeroCurve",
  "geometry.zeroArc",
  "geometry.arcEndOffCircle",
  "geometry.closedSingleLine",
  "document.padOffStock",
  "document.duplicateShape",
  "document.duplicateModel",
  "document.duplicateOperation",
  "document.unknownModel",
  "document.unknownShape",
  "document.unknownPath",
  "operation.pathIndices",
  "operation.allowanceZeroOnLine",
  "operation.allowanceNeeded",
  "operation.vBitsCantDrill",
  "operation.drillsCantEngrave",
  "operation.flatBottomEndMill",
  "operation.onlyVBitsVCarve",
  "operation.modelNotShapes",
  "operation.peelStart",
  "operation.drillsCantCutSideways",
  "archive.notAProject",
  "archive.modelDamaged",
  "archive.versionDamaged",
  "archive.versionTooNew",
  "archive.versionInvalid",
  "archive.versionMissingModel",
  "archive.tooManyMeshes",
  "archive.tooManyVersions",
  "archive.documentTooLarge",
  "archive.fileTooLarge",
  "archive.meshTooLarge",
  "migration.notObject",
  "migration.invalidVersion",
  "migration.tooNew",
  "migration.missing",
  "migration.notObjectResult",
] as const;

export type DocumentMessageCode = (typeof DOCUMENT_MESSAGES)[number];
export type DocumentMessage = Message<DocumentMessageCode>;

const CODES = new Set<string>(DOCUMENT_MESSAGES);

/** The parts of a Zod issue `issueMessage` reads. */
type Issue = {
  code: string;
  message: string;
  origin?: string;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  divisor?: number | bigint;
};

/** Whether `text` is one of the document package's codes, e.g. a Zod issue's message. */
export function isDocumentMessageCode(text: unknown): text is DocumentMessageCode {
  return typeof text === "string" && CODES.has(text);
}

/**
 * A Zod issue as a message: the code a schema gave it, with its limit, or
 * else a generic one for its kind, e.g. "at most {max}" for a number too big.
 */
export function issueMessage(issue: Issue): DocumentMessage {
  const min = issue.minimum === undefined ? undefined : Number(issue.minimum);
  const max = issue.maximum === undefined ? undefined : Number(issue.maximum);
  if (isDocumentMessageCode(issue.message)) {
    const values: Record<string, number> = {};
    if (min !== undefined) values.min = min;
    if (max !== undefined) values.max = max;
    return Object.keys(values).length > 0
      ? { code: issue.message, values }
      : { code: issue.message };
  }
  const text = issue.origin === "string" || issue.origin === "array";
  switch (issue.code) {
    case "too_small":
      if (text) {
        return min !== undefined && min > 1
          ? { code: "validation.minCharacters", values: { min } }
          : { code: "validation.required" };
      }
      return {
        code: issue.inclusive === false ? "validation.greaterThan" : "validation.atLeast",
        values: { min: min ?? 0 },
      };
    case "too_big":
      if (text) return { code: "validation.maxCharacters", values: { max: max ?? 0 } };
      return {
        code: issue.inclusive === false ? "validation.lessThan" : "validation.atMost",
        values: { max: max ?? 0 },
      };
    case "invalid_type":
      return issue.expected === "int"
        ? { code: "validation.wholeNumber" }
        : { code: "validation.invalid" };
    case "invalid_value":
      return { code: "validation.choose" };
    case "not_multiple_of":
      return { code: "validation.multipleOf", values: { divisor: Number(issue.divisor ?? 1) } };
    default:
      return { code: "validation.invalid" };
  }
}
