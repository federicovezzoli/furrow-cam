import { describe, expect, it } from "vitest";
import { z } from "zod";
import { issuesToFormErrors, numberField } from "./form-data";

const Schema = z.object({ diameter: z.number().positive(), stepDown: z.number().positive() });

function errorsFor(form: FormData) {
  const input = {
    diameter: numberField(form, "diameter"),
    stepDown: numberField(form, "stepDown"),
  };
  const result = Schema.safeParse(input);
  return result.success ? {} : issuesToFormErrors(result.error.issues, input);
}

describe("numberField", () => {
  it("reads numbers, blanks and text that isn't a number", () => {
    const form = new FormData();
    form.set("a", "6.35");
    form.set("b", " ");
    form.set("c", "1/4in");
    expect(numberField(form, "a")).toBe(6.35);
    expect(numberField(form, "b")).toBeNull();
    expect(numberField(form, "c")).toBeNaN();
    expect(numberField(form, "missing")).toBeNull();
  });
});

describe("issuesToFormErrors", () => {
  it("names blanks and values that aren't numbers", () => {
    const form = new FormData();
    form.set("diameter", "abc");
    expect(errorsFor(form)).toEqual({ diameter: "Must be a number", stepDown: "Required" });
  });

  it("keeps the schema's message otherwise", () => {
    const form = new FormData();
    form.set("diameter", "-1");
    form.set("stepDown", "1");
    expect(errorsFor(form).diameter).toMatch(/>0/);
  });
});
