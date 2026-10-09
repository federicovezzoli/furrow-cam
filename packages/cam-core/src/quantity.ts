import type { Units } from "@furrow/document";
import { toMillimetres } from "./units";

/**
 * What a numeric field holds: a length (mm internally), a feed rate (mm/min
 * internally) or a plain number such as a count, a speed or a percentage.
 */
export type Quantity = "length" | "feed" | "number";

/** Unit suffixes a field accepts, as the factor that converts them to the internal unit. */
const UNIT_FACTORS: Record<Quantity, Readonly<Record<string, number>>> = {
  length: { mm: 1, cm: 10, m: 1000, in: 25.4, '"': 25.4, ft: 304.8 },
  feed: { "mm/min": 1, "mm/s": 60, "in/min": 25.4, ipm: 25.4 },
  number: {},
};

/** Suffixes longest first, so `mm` wins over `m` and `in/min` over `in`. */
const SUFFIXES = Object.fromEntries(
  Object.entries(UNIT_FACTORS).map(([quantity, factors]) => [
    quantity,
    Object.keys(factors).sort((a, b) => b.length - a.length),
  ]),
) as Record<Quantity, string[]>;

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Reads what was typed into a numeric field: a number or a simple expression
 * (`+ - * /`, parentheses), optionally followed by one unit that applies to
 * the whole of it, e.g. `6.35`, `6.35mm`, `1/4in`, `1/4"`, `10/2`. Without a
 * unit, the value is in the display `units`. Returns the value in the
 * internal unit (millimetres for lengths, mm/min for feeds, ADR-0007).
 */
export function parseQuantity(text: string, quantity: Quantity, units: Units): ParseResult {
  let expression = text.trim().toLowerCase();
  if (expression === "") return { ok: false, error: "Enter a number" };

  let factor = displayFactor(quantity, units);
  const suffix = SUFFIXES[quantity].find((unit) => hasSuffix(expression, unit));
  if (suffix !== undefined) {
    factor = UNIT_FACTORS[quantity][suffix] as number;
    expression = expression.slice(0, -suffix.length).trimEnd();
  }

  const result = evaluate(expression);
  if (!result.ok) return result;
  const value = result.value * factor;
  if (!Number.isFinite(value)) return { ok: false, error: "The result isn't a finite number" };
  return { ok: true, value };
}

/** A value in the internal unit, written in the display `units` for an input. */
export function formatQuantity(value: number, quantity: Quantity, units: Units): string {
  const display = value / displayFactor(quantity, units);
  // Four decimals of an inch are finer than three of a millimetre, as both are finer than a cut.
  const digits = quantity !== "number" && units === "in" ? 4 : 3;
  return Number(display.toFixed(digits)).toString();
}

/** The display unit's label, e.g. `mm`, `in/min`, or `""` for plain numbers. */
export function unitLabel(quantity: Quantity, units: Units): string {
  if (quantity === "number") return "";
  return quantity === "feed" ? `${units}/min` : units;
}

/** Converts from the display `units` to the internal unit. */
export function toInternal(value: number, quantity: Quantity, units: Units): number {
  return value * displayFactor(quantity, units);
}

/** Converts from the internal unit to the display `units`. */
export function fromInternal(value: number, quantity: Quantity, units: Units): number {
  return value / displayFactor(quantity, units);
}

/**
 * `value` rounded to a multiple of `step`, without the floating-point noise
 * of the multiplication (`0.1 * 3` is `0.30000000000000004`).
 */
export function snapToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(10));
}

function displayFactor(quantity: Quantity, units: Units): number {
  return quantity === "number" ? 1 : toMillimetres(1, units);
}

/** Whether `text` ends with the unit `suffix`, not inside a longer word (`10mm` isn't `m`). */
function hasSuffix(text: string, suffix: string): boolean {
  if (!text.endsWith(suffix)) return false;
  const before = text.at(-suffix.length - 1);
  return before === undefined || !/[a-z]/.test(before) || !/^[a-z]/.test(suffix);
}

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

function tokenize(expression: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([-+*/()])|(\S+))/y;
  let match = pattern.exec(expression);
  while (match !== null && match[0] !== "") {
    const [, number, op, other] = match;
    if (number !== undefined) tokens.push({ kind: "number", value: Number(number) });
    else if (op !== undefined) tokens.push({ kind: "op", value: op });
    else {
      const word = (other as string).match(/^[a-z]+/)?.[0];
      return { error: word ? `Unknown unit "${word}"` : "Not a number or expression" };
    }
    match = pattern.exec(expression);
  }
  return tokens;
}

/** Evaluates `+ - * /` with the usual precedence, unary signs and parentheses. */
function evaluate(expression: string): ParseResult {
  const tokenized = tokenize(expression);
  if (!Array.isArray(tokenized)) return { ok: false, error: tokenized.error };
  const tokens: Token[] = tokenized;
  if (tokens.length === 0) return { ok: false, error: "Enter a number" };

  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => {
    const token = peek();
    return token?.kind === "op" && token.value === value;
  };

  function sum(): number {
    let value = product();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[position++] as Token).value;
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function product(): number {
    let value = factor();
    while (isOp("*") || isOp("/")) {
      const op = (tokens[position++] as Token).value;
      const right = factor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function factor(): number {
    const token = tokens[position++];
    if (token === undefined) throw new SyntaxError();
    if (token.kind === "number") return token.value;
    if (token.value === "-") return -factor();
    if (token.value === "+") return factor();
    if (token.value === "(") {
      const value = sum();
      if (!isOp(")")) throw new SyntaxError();
      position++;
      return value;
    }
    throw new SyntaxError();
  }

  try {
    const value = sum();
    if (position !== tokens.length) throw new SyntaxError();
    return { ok: true, value };
  } catch {
    return { ok: false, error: "Not a number or expression" };
  }
}
