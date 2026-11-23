// @vitest-environment jsdom
import { LocaleProvider } from "@furrow/ui/components/locale-provider";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUsageSettings } from "@/lib/telemetry";
import { UsageConsent } from "./usage-consent";

let consent: "granted" | "denied" | "pending" = "pending";
vi.mock("posthog-js/no-external", () => ({
  default: { get_explicit_consent_status: () => consent },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function renderConsent() {
  const onChange = vi.fn((agreed: boolean) => {
    consent = agreed ? "granted" : "denied";
  });
  render(
    <LocaleProvider locale="en" onLocaleChange={() => {}}>
      <UsageConsent onChange={onChange} />
    </LocaleProvider>,
  );
  return onChange;
}

beforeEach(() => {
  consent = "pending";
});
afterEach(cleanup);

describe("UsageConsent", () => {
  it("asks a visitor who hasn't answered, and closes on the answer", () => {
    const onChange = renderConsent();
    expect(screen.getByRole("heading", { name: "Help improve Furrow CAM?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("stays closed once answered, and reopens from the usage settings with the answer", () => {
    consent = "granted";
    const onChange = renderConsent();
    expect(screen.queryByRole("heading")).toBeNull();
    act(openUsageSettings);
    expect(screen.getByText("You currently allow this.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(onChange).toHaveBeenCalledWith(false);
    act(openUsageSettings);
    expect(screen.getByText("You currently don't allow this.")).toBeTruthy();
  });
});
