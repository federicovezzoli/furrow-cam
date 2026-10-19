import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function request(path: string, signedIn: boolean) {
  const headers = new Headers();
  if (signedIn) headers.set("cookie", "better-auth.session_token=abc");
  return new NextRequest(new URL(path, "https://app.furrow.cam"), { headers });
}

function redirect(response: Response) {
  return response.headers.get("location");
}

describe("proxy", () => {
  it("opens the guest workspace at / without a session", () => {
    expect(redirect(proxy(request("/", false)))).toBeNull();
  });

  it("sends signed-in users from / to their projects", () => {
    expect(redirect(proxy(request("/", true)))).toBe("https://app.furrow.cam/projects");
  });

  it("starts a new guest project at /new, or sends signed-in users to theirs", () => {
    expect(redirect(proxy(request("/new", false)))).toBeNull();
    expect(redirect(proxy(request("/new", true)))).toBe("https://app.furrow.cam/projects");
  });

  it("still requires a session for bits and machines", () => {
    expect(redirect(proxy(request("/tools", false)))).toBe("https://app.furrow.cam/sign-in");
    expect(redirect(proxy(request("/machines/new", false)))).toBe("https://app.furrow.cam/sign-in");
    expect(redirect(proxy(request("/tools", true)))).toBeNull();
  });

  it("leaves projects to the pages, which show the browser's without a session", () => {
    expect(config.matcher.some((path) => path.startsWith("/projects"))).toBe(false);
  });
});
