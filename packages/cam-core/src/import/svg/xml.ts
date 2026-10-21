/**
 * An XML element. Text content is dropped since importing geometry never
 * needs it, except a `style` element's stylesheet, which can hide elements.
 */
export type XmlElement = {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** A `style` element's text, CDATA sections included. */
  text?: string;
};

/** What is wrong, for the user: an element left open, a closing tag that matches no open element, or a bad attribute. */
export type XmlProblem = { unclosed: string } | { closing: string } | { attribute: string };

export class XmlError extends Error {
  /** The developer-facing `message` names the problem; the user is told where it is, and `problem`. */
  constructor(
    message: string,
    readonly position: number,
    readonly problem?: XmlProblem,
  ) {
    super(`${message} (at character ${position})`);
  }
}

const NAME = /[^\s/>=]+/y;
const SPACE = /\s*/y;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    // Entities declared in a DOCTYPE (old Illustrator exports) are left as they are.
    return ENTITIES[entity] ?? match;
  });
}

/**
 * Parses an XML document into its root element. A small non-validating
 * parser: workers have no `DOMParser` (ADR-0004), and SVG files only need
 * elements, attributes and the text of `style` elements. Comments,
 * processing instructions, CDATA elsewhere and the DOCTYPE are skipped.
 */
export function parseXml(text: string): XmlElement {
  let index = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  function fail(message: string, problem?: XmlProblem): never {
    throw new XmlError(message, index, problem);
  }

  function skipPast(terminator: string) {
    const end = text.indexOf(terminator, index);
    if (end === -1) fail(`Missing "${terminator}"`);
    index = end + terminator.length;
  }

  function skipSpace() {
    SPACE.lastIndex = index;
    SPACE.exec(text);
    index = SPACE.lastIndex;
  }

  function readName(): string {
    NAME.lastIndex = index;
    const match = NAME.exec(text);
    if (!match) fail("Expected a name");
    index = NAME.lastIndex;
    return match[0];
  }

  while (index < text.length) {
    const open = text.indexOf("<", index);
    if (open === -1) break;
    index = open;
    if (text.startsWith("<!--", index)) {
      skipPast("-->");
    } else if (text.startsWith("<![CDATA[", index)) {
      skipPast("]]>");
    } else if (text.startsWith("<?", index)) {
      skipPast("?>");
    } else if (text.startsWith("<!", index)) {
      // DOCTYPE, possibly with an internal subset in brackets.
      const bracket = text.indexOf("[", index);
      const close = text.indexOf(">", index);
      if (close === -1) fail('Missing ">"');
      if (bracket !== -1 && bracket < close) skipPast("]");
      skipPast(">");
    } else if (text.startsWith("</", index)) {
      index += 2;
      const name = readName();
      skipSpace();
      if (text[index] !== ">") fail('Expected ">"');
      index++;
      const element = stack.pop();
      if (element?.name !== name) fail(`Unexpected closing tag </${name}>`, { closing: name });
    } else {
      index++;
      const element: XmlElement = { name: readName(), attributes: {}, children: [] };
      for (;;) {
        skipSpace();
        if (text.startsWith("/>", index)) {
          index += 2;
          break;
        }
        if (text[index] === ">") {
          index++;
          stack.push(element);
          if (element.name === "style" || element.name.endsWith(":style")) {
            // A stylesheet is text up to its closing tag, which the loop then reads.
            const close = text.indexOf(`</${element.name}`, index);
            if (close === -1) fail(`Unclosed tag <${element.name}>`, { unclosed: element.name });
            element.text = decodeEntities(
              text.slice(index, close).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
            );
            index = close;
          }
          break;
        }
        if (index >= text.length) {
          fail(`Unclosed tag <${element.name}>`, { unclosed: element.name });
        }
        const name = readName();
        skipSpace();
        if (text[index] !== "=") fail(`Expected "=" after attribute ${name}`, { attribute: name });
        index++;
        skipSpace();
        const quote = text[index];
        if (quote !== '"' && quote !== "'") {
          fail(`Expected a quoted value for attribute ${name}`, { attribute: name });
        }
        const end = text.indexOf(quote, index + 1);
        if (end === -1) fail(`Unterminated value of attribute ${name}`, { attribute: name });
        element.attributes[name] = decodeEntities(text.slice(index + 1, end));
        index = end + 1;
      }
      const parent = stack.at(element === stack.at(-1) ? -2 : -1);
      if (parent) parent.children.push(element);
      else if (root) fail("More than one root element");
      else root = element;
    }
  }

  const open = stack.at(-1);
  if (open) fail(`Unclosed tag <${open.name}>`, { unclosed: open.name });
  if (!root) throw new XmlError("No root element", index);
  return root;
}
