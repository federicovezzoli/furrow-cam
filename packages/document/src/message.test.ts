import { describe, expect, it } from "vitest";
import { z } from "zod";
import { issueMessage } from "./message";
import { SpindleRpm } from "./units";

const issue = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("valid");
  return issueMessage(result.error.issues[0] as never);
};

describe("issueMessage", () => {
  it("keeps a schema's code, with its limit", () => {
    expect(issue(SpindleRpm, 200_000)).toEqual({
      code: "validation.maxRpm",
      values: { max: 100_000 },
    });
  });

  it("names the kind of issue otherwise", () => {
    expect(issue(z.number().positive(), 0)).toEqual({
      code: "validation.greaterThan",
      values: { min: 0 },
    });
    expect(issue(z.number().max(5), 6)).toEqual({ code: "validation.atMost", values: { max: 5 } });
    expect(issue(z.number().int(), 1.5)).toEqual({ code: "validation.wholeNumber" });
    expect(issue(z.string().min(1), "")).toEqual({ code: "validation.required" });
    expect(issue(z.string().max(3), "abcd")).toEqual({
      code: "validation.maxCharacters",
      values: { max: 3 },
    });
    expect(issue(z.enum(["a", "b"]), "c")).toEqual({ code: "validation.choose" });
  });
});
