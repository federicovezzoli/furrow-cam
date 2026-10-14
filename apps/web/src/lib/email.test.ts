import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import ResetPassword from "@/emails/reset-password";
import VerifyEmail from "@/emails/verify-email";
import { renderEmail, sendEmail } from "./email";

vi.mock("@/env", () => ({ env: { EMAIL_FROM: "Furrow CAM <test@example.com>" } }));

const url = "https://furrow.example/api/auth/verify-email?token=abc&callbackURL=%2Fprojects";

const templates = [
  ["verification", createElement(VerifyEmail, { url })],
  ["password reset", createElement(ResetPassword, { url })],
] as const;

describe.each(templates)("%s email", (_, template) => {
  it("puts the link in the HTML, as the button and the fallback", async () => {
    const { html } = await renderEmail(template);
    const href = url.replaceAll("&", "&amp;");
    expect(html.split(`href="${href}"`)).toHaveLength(3);
  });

  it("puts the link in the plain-text version", async () => {
    const { text } = await renderEmail(template);
    expect(text).toContain(url);
    expect(text).toContain("Furrow CAM");
    expect(text).not.toContain("<");
    expect(text).not.toContain("button doesn't work");
  });

  it("loads no remote images, fonts or stylesheets", async () => {
    const { html } = await renderEmail(template);
    expect(html).not.toMatch(/<img|<link|@import|url\(/i);
  });
});

describe("sendEmail without RESEND_API_KEY", () => {
  it("prints the text version with the link", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendEmail({ to: "a@example.com", subject: "Hi", template: templates[0][1] });
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toContain(url);
    expect(info.mock.calls[0][0]).not.toContain("<html");
    info.mockRestore();
  });
});
