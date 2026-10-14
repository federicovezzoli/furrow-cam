const RANGE_URL = "https://api.pwnedpasswords.com/range/";

/**
 * Whether the password appears in the Have I Been Pwned corpus (ADR-0023). Only the first
 * five hex characters of its SHA-1 hash are sent (k-anonymity), with padded responses.
 * Returns `null` when the check could not be done (network error, non-200, timeout).
 */
export async function isPasswordBreached(
  password: string,
  { fetch: fetchFn = fetch, timeoutMs = 3000 }: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean | null> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await fetchFn(RANGE_URL + prefix, {
      headers: { "Add-Padding": "true", "User-Agent": "Furrow CAM" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    for (const line of (await response.text()).split("\n")) {
      const [lineSuffix, count] = line.trim().split(":");
      // Padding entries have a count of 0.
      if (lineSuffix?.toUpperCase() === suffix) return Number(count) > 0;
    }
    return false;
  } catch {
    return null;
  }
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
