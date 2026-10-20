import { endMill, fullDocument, machine, OPERATION_ID } from "@furrow/document/fixtures";
import { describe, expect, it } from "vitest";
import {
  blankReportUrl,
  MAX_REPORT_URL_LENGTH,
  MAX_TITLE_LENGTH,
  NEW_ISSUE_URL,
  PASTE_PROMPT,
  projectDiagnostics,
  reportBody,
  reportUrl,
  SCREENSHOT_PROMPT,
} from "./bug-report";

describe("reportBody", () => {
  it("lists one-line diagnostics and puts multi-line ones in a JSON block", () => {
    const body = reportBody("  Pocket left an island  ", [
      ["App", "web 1.2.3"],
      ["Selected operation", '{\n  "type": "pocket"\n}'],
      ["Units", "mm"],
    ]);
    expect(body).toBe(
      [
        "### What happened",
        "",
        "Pocket left an island",
        "",
        "### Diagnostics",
        "",
        "- App: web 1.2.3",
        "- Units: mm",
        "",
        "Selected operation:",
        "",
        "```json",
        '{\n  "type": "pocket"\n}',
        "```",
      ].join("\n"),
    );
  });

  it("leaves a place for the screenshot, which the user pastes in", () => {
    expect(reportBody("Broken", [], true)).toContain(
      `### Screenshot\n\n${SCREENSHOT_PROMPT}\n\n###`,
    );
    expect(reportBody("Broken", [])).not.toContain("### Screenshot");
  });

  it("asks for a description when there is none", () => {
    expect(reportBody(" ", [])).toContain("<!-- What did you do");
  });
});

describe("reportUrl", () => {
  it("prefills the title, the body and the bug label", () => {
    const { url, fits } = reportUrl("Crash & burn", "Body #1");
    expect(fits).toBe(true);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(NEW_ISSUE_URL);
    expect(parsed.searchParams.get("title")).toBe("Crash & burn");
    expect(parsed.searchParams.get("body")).toBe("Body #1");
    expect(parsed.searchParams.get("labels")).toBe("bug");
  });

  it("asks to paste a body too long for the URL", () => {
    const { url, fits } = reportUrl("Title", "x".repeat(MAX_REPORT_URL_LENGTH));
    expect(fits).toBe(false);
    expect(url.length).toBeLessThanOrEqual(MAX_REPORT_URL_LENGTH);
    expect(new URL(url).searchParams.get("body")).toBe(PASTE_PROMPT);
    expect(new URL(url).searchParams.get("title")).toBe("Title");
  });

  it("cuts the title to GitHub's limit, also when the body is pasted", () => {
    const title = "x".repeat(MAX_TITLE_LENGTH * 30);
    for (const body of ["short", "x".repeat(MAX_REPORT_URL_LENGTH)]) {
      const { url } = reportUrl(title, body);
      expect(new URL(url).searchParams.get("title")).toHaveLength(MAX_TITLE_LENGTH);
      expect(url.length).toBeLessThanOrEqual(MAX_REPORT_URL_LENGTH);
    }
  });

  it("measures the encoded length, not the text's", () => {
    // Each "é" takes 6 characters once percent-encoded.
    expect(reportUrl("", "é".repeat(MAX_REPORT_URL_LENGTH / 4)).fits).toBe(false);
  });
});

describe("blankReportUrl", () => {
  it("opens a draft with only the diagnostics", () => {
    const body = new URL(blankReportUrl([["App", "desktop 0.1.0"]])).searchParams.get("body");
    expect(body).toContain("- App: desktop 0.1.0");
  });
});

describe("projectDiagnostics", () => {
  it("describes the document, the machine and the selected operation without names or geometry", () => {
    const document = fullDocument();
    const [profile] = document.operations;
    if (profile) profile.tool = { ...endMill, notes: "Bought at Ann's shop" };
    const diagnostics = projectDiagnostics(document, OPERATION_ID);
    expect(diagnostics.slice(0, 3)).toEqual([
      ["Document schema", "15"],
      ["Units", "in"],
      ["Machine", `${machine.name} (grbl)`],
    ]);
    const [label, value] = diagnostics[3] ?? [];
    expect(label).toBe("Selected operation");
    const operation = JSON.parse(value ?? "");
    expect(operation).toMatchObject({ type: "profile", targets: 2, params: { side: "outside" } });
    expect(operation).not.toHaveProperty("name");
    expect(operation).not.toHaveProperty("id");
    expect(operation.tool).toMatchObject({ type: "flat_end_mill", diameter: 6.35 });
    expect(value).not.toContain(endMill.name);
    expect(value).not.toContain("Ann's shop");
  });

  it("leaves the operation out when none is selected", () => {
    const document = { ...fullDocument(), machine: null };
    expect(projectDiagnostics(document, null)).toEqual([
      ["Document schema", "15"],
      ["Units", "in"],
      ["Machine", "none"],
    ]);
  });
});
