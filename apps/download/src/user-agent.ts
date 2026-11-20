// Coarse labels for a download's User-Agent header (ADR-0090). Only these labels are
// stored, never the header itself.

export type ClientKind = "browser" | "bot" | "cli" | "other" | "none";
export type OsFamily = "macos" | "windows" | "linux" | "other";
export type BrowserFamily = "chrome" | "safari" | "firefox" | "edge" | "other";

const BOT =
  /bot\b|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|lighthouse|headless/i;
const CLI =
  /curl|wget|python|go-http-client|node-fetch|undici|axios|okhttp|httpie|powershell|libwww-perl|java\/|aria2|winhttp/i;

function clientKind(ua: string): ClientKind {
  if (BOT.test(ua)) return "bot";
  if (CLI.test(ua)) return "cli";
  return ua.startsWith("Mozilla/") ? "browser" : "other";
}

function osFamily(ua: string): OsFamily {
  // Phones and tablets first: iOS says "like Mac OS X", Android says "Linux".
  if (/iPhone|iPad|iPod|Android/.test(ua)) return "other";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  return /Linux|X11/.test(ua) ? "linux" : "other";
}

function browserFamily(ua: string): BrowserFamily {
  // Edge and Chrome also say "Safari/", and Edge says "Chrome/".
  if (/Edg(e|A|iOS)?\//.test(ua)) return "edge";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "chrome";
  return /Safari\//.test(ua) ? "safari" : "other";
}

export function userAgentLabels(ua: string | null): [ClientKind, OsFamily, BrowserFamily] {
  if (!ua) return ["none", "other", "other"];
  return [clientKind(ua), osFamily(ua), browserFamily(ua)];
}
