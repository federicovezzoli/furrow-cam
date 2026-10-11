import { describe, expect, it } from "vitest";
import { fullDocument } from "./fixtures";
import { ProfileParams } from "./operation";

const params = fullDocument().operations[0]?.params as ProfileParams;

describe("ProfileParams", () => {
  it("accepts the fixture", () => {
    expect(ProfileParams.parse(params)).toEqual(params);
    expect(
      ProfileParams.safeParse({ ...params, leadIn: null, ramp: false, tabs: null }).success,
    ).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(ProfileParams.safeParse({ ...params, depth: 0 }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, allowance: -0.1 }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, leadIn: { radius: 0 } }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, side: "left" }).success).toBe(false);
  });

  it("rejects tabs without a width or height, or with malformed positions", () => {
    const tabs = { width: 8, height: 3, positions: [[50, 0]] };
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, positions: [] } }).success).toBe(
      true,
    );
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, width: 0 } }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, height: -1 } }).success).toBe(
      false,
    );
    expect(
      ProfileParams.safeParse({ ...params, tabs: { ...tabs, positions: [[50]] } }).success,
    ).toBe(false);
    expect(ProfileParams.safeParse({ ...params, tabs: { ...tabs, count: 4 } }).success).toBe(false);
  });

  it("allows no allowance on the line", () => {
    const onLine = { ...params, side: "on", allowance: 0, finishPass: false };
    expect(ProfileParams.safeParse(onLine).success).toBe(true);
    expect(ProfileParams.safeParse({ ...onLine, allowance: 0.5 }).success).toBe(false);
  });

  it("needs an allowance for a finish pass", () => {
    expect(ProfileParams.safeParse({ ...params, allowance: 0 }).success).toBe(false);
    expect(ProfileParams.safeParse({ ...params, allowance: 0, finishPass: false }).success).toBe(
      true,
    );
  });
});
