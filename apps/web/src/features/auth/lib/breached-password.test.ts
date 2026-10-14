import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isPasswordBreached } from "./breached-password";

const PASSWORD = "password123";
const HASH = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
const PREFIX = HASH.slice(0, 5);
const SUFFIX = HASH.slice(5);

function respond(body: string, status = 200) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status }));
}

describe("isPasswordBreached", () => {
  it("sends only the five-character hash prefix, with padding", async () => {
    const fetch = respond("");
    await isPasswordBreached(PASSWORD, { fetch });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(new Headers(init?.headers).get("Add-Padding")).toBe("true");
  });

  it("reports a listed password as breached", async () => {
    const fetch = respond(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:2254650\r\n`);
    expect(await isPasswordBreached(PASSWORD, { fetch })).toBe(true);
  });

  it("matches the suffix case-insensitively", async () => {
    const fetch = respond(`${SUFFIX.toLowerCase()}:3`);
    expect(await isPasswordBreached(PASSWORD, { fetch })).toBe(true);
  });

  it("ignores padding entries with a count of 0", async () => {
    const fetch = respond(`${SUFFIX}:0\r\n`);
    expect(await isPasswordBreached(PASSWORD, { fetch })).toBe(false);
  });

  it("reports an unlisted password as not breached", async () => {
    const fetch = respond("0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n");
    expect(await isPasswordBreached(PASSWORD, { fetch })).toBe(false);
  });

  it("returns null on a non-200 response", async () => {
    expect(await isPasswordBreached(PASSWORD, { fetch: respond("", 503) })).toBeNull();
  });

  it("returns null on a network error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await isPasswordBreached(PASSWORD, { fetch })).toBeNull();
  });

  it("returns null when hashing fails", async () => {
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("no SHA-1"));
    const fetch = respond("");
    expect(await isPasswordBreached(PASSWORD, { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("returns null when the API does not answer in time", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(await isPasswordBreached(PASSWORD, { fetch, timeoutMs: 10 })).toBeNull();
  });
});
