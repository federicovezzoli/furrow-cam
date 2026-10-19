import type { XmlElement } from "./xml";

// Just enough CSS to tell which elements a drawing hides: the `display` and
// `visibility` an element ends up with from its `style` attribute, the
// stylesheets in `style` elements and its presentation attributes.

/** The properties the importer resolves. */
export type StyleProperty = "display" | "visibility";

/** A compound selector the importer can match: a type and any number of classes and ids. */
type Selector = { type: string | null; classes: string[]; ids: string[] };

type Declaration = { property: StyleProperty; value: string; important: boolean };

type Rule = {
  selectors: Selector[];
  declarations: Declaration[];
  /** Position in the document, later rules winning ties. */
  order: number;
};

/** How a declaration ranks in the cascade, compared element by element: higher wins. */
type Rank = [
  important: number,
  origin: number,
  ids: number,
  classes: number,
  types: number,
  order: number,
];

const PROPERTIES = new Set<string>(["display", "visibility"]);
const COMPOUND = /^(\*|[A-Za-z_][\w-]*)?((?:[.#][A-Za-z_-][\w-]*)*)$/;

/** The rules of a document's stylesheets, and whether any that hide elements couldn't be read. */
export class Stylesheet {
  private readonly rules: Rule[] = [];
  /** Whether a rule the importer can't match would hide elements. */
  readonly unresolvedHiding: boolean = false;

  constructor(root: XmlElement) {
    const sheets: string[] = [];
    collectStyles(root, sheets);
    for (const sheet of sheets) {
      for (const { prelude, body } of ruleBlocks(sheet)) {
        const declarations = parseDeclarations(body);
        if (declarations.length === 0) continue;
        const selectors: Selector[] = [];
        let unresolved = false;
        for (const text of prelude.split(",")) {
          const selector = parseSelector(text.trim());
          if (selector) selectors.push(selector);
          else unresolved = true;
        }
        if (unresolved && declarations.some(hides)) this.unresolvedHiding = true;
        if (selectors.length > 0) {
          this.rules.push({ selectors, declarations, order: this.rules.length });
        }
      }
    }
  }

  /**
   * The value of `property` the cascade gives `element`, lowercased, or
   * `undefined` if nothing sets it: `!important` first, then the `style`
   * attribute, stylesheet rules by specificity and order, and last the
   * presentation attribute.
   */
  value(element: XmlElement, property: StyleProperty): string | undefined {
    let best: { rank: Rank; value: string } | null = null;
    const consider = (rank: Rank, value: string) => {
      if (!best || outranks(rank, best.rank)) best = { rank, value };
    };
    const attribute = element.attributes[property];
    if (attribute !== undefined) consider([0, 0, 0, 0, 0, 0], attribute.trim().toLowerCase());
    if (this.rules.length > 0) {
      const classes = (element.attributes.class ?? "").split(/\s+/).filter(Boolean);
      const name = localName(element);
      for (const rule of this.rules) {
        let specificity: [number, number, number] | null = null;
        for (const selector of rule.selectors) {
          if (!matches(selector, name, element.attributes.id, classes)) continue;
          const own: [number, number, number] = [
            selector.ids.length,
            selector.classes.length,
            selector.type && selector.type !== "*" ? 1 : 0,
          ];
          if (!specificity || outranks(own, specificity)) specificity = own;
        }
        if (!specificity) continue;
        for (const declaration of rule.declarations) {
          if (declaration.property !== property) continue;
          consider([+declaration.important, 1, ...specificity, rule.order], declaration.value);
        }
      }
    }
    for (const declaration of parseDeclarations(element.attributes.style ?? "")) {
      if (declaration.property !== property) continue;
      consider([+declaration.important, 2, 0, 0, 0, 0], declaration.value);
    }
    return (best as { value: string } | null)?.value;
  }
}

function collectStyles(element: XmlElement, sheets: string[]) {
  if (localName(element) === "style" && element.text !== undefined) {
    const type = element.attributes.type?.trim().toLowerCase();
    if (!type || type === "text/css") sheets.push(element.text);
  }
  for (const child of element.children) collectStyles(child, sheets);
}

/** The top-level rules of a stylesheet; at-rules such as `@media` and `@font-face` are skipped. */
function* ruleBlocks(sheet: string): Generator<{ prelude: string; body: string }> {
  const text = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    const semicolon = text.indexOf(";", index);
    const prelude = text.slice(index, open === -1 ? text.length : open).trim();
    if (prelude.startsWith("@") && semicolon !== -1 && (open === -1 || semicolon < open)) {
      // A statement at-rule such as `@import`.
      index = semicolon + 1;
      continue;
    }
    if (open === -1) return;
    const close = matchingBrace(text, open);
    if (!prelude.startsWith("@")) yield { prelude, body: text.slice(open + 1, close) };
    index = close + 1;
  }
}

/** Where the block opened at `open` closes, nested blocks included, or the end of `text`. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return text.length;
}

/** The `display` and `visibility` declarations of a rule body or `style` attribute. */
function parseDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    if (!PROPERTIES.has(property)) continue;
    let value = part
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    const important = /!\s*important$/.test(value);
    if (important) value = value.replace(/!\s*important$/, "").trim();
    declarations.push({ property: property as StyleProperty, value, important });
  }
  return declarations;
}

/** A compound selector, or `null` for one with combinators, attributes or pseudo-classes. */
function parseSelector(text: string): Selector | null {
  const match = COMPOUND.exec(text);
  if (!match || text === "") return null;
  const parts = match[2]?.match(/[.#][^.#]+/g) ?? [];
  return {
    type: match[1] ?? null,
    classes: parts.filter((part) => part[0] === ".").map((part) => part.slice(1)),
    ids: parts.filter((part) => part[0] === "#").map((part) => part.slice(1)),
  };
}

function matches(
  selector: Selector,
  name: string,
  id: string | undefined,
  classes: string[],
): boolean {
  return (
    (selector.type === null || selector.type === "*" || selector.type === name) &&
    selector.ids.every((wanted) => wanted === id) &&
    selector.classes.every((wanted) => classes.includes(wanted))
  );
}

function hides({ property, value }: Declaration): boolean {
  return property === "display" ? value === "none" : value === "hidden" || value === "collapse";
}

function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return false;
}

function localName(element: XmlElement): string {
  return element.name.startsWith("svg:") ? element.name.slice(4) : element.name;
}
