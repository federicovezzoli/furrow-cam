import { describe, expect, it } from "vitest";
import { parseXml, XmlError } from "./xml";

describe("parseXml", () => {
  it("reads nested elements and attributes, skipping text", () => {
    const root = parseXml(`<a x="1" y='two'>text<b/><c z="3">more</c></a>`);
    expect(root).toEqual({
      name: "a",
      attributes: { x: "1", y: "two" },
      children: [
        { name: "b", attributes: {}, children: [] },
        { name: "c", attributes: { z: "3" }, children: [] },
      ],
    });
  });

  it("skips the prolog, comments, CDATA and a DOCTYPE with an internal subset", () => {
    const root = parseXml(`<?xml version="1.0"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd" [
        <!ENTITY ns_svg "http://www.w3.org/2000/svg">
      ]>
      <!-- <fake/> -->
      <svg xmlns="&ns_svg;"><![CDATA[ <fake/> ]]><g/></svg>`);
    expect(root.name).toBe("svg");
    expect(root.attributes.xmlns).toBe("&ns_svg;");
    expect(root.children.map((child) => child.name)).toEqual(["g"]);
  });

  it("decodes entities in attribute values", () => {
    const root = parseXml(`<a v="&lt;&amp;&gt; &quot;&apos; &#65;&#x42;"/>`);
    expect(root.attributes.v).toBe(`<&> "' AB`);
  });

  it("keeps attribute names with namespace prefixes", () => {
    const root = parseXml(`<svg inkscape:label="Layer 1" xlink:href="#a"/>`);
    expect(root.attributes).toEqual({ "inkscape:label": "Layer 1", "xlink:href": "#a" });
  });

  it.each([
    ["mismatched tags", "<a><b></a>"],
    ["an unclosed element", "<a><b/>"],
    ["an unquoted attribute", "<a x=1/>"],
    ["two root elements", "<a/><b/>"],
    ["no element", "just text"],
  ])("rejects %s", (_, text) => {
    expect(() => parseXml(text)).toThrow(XmlError);
  });
});
