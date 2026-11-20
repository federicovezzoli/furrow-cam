import { describe, expect, it } from "vitest";
import { userAgentLabels } from "./user-agent";

describe("userAgentLabels", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      ["browser", "macos", "safari"],
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ["browser", "macos", "chrome"],
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      ["browser", "windows", "edge"],
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
      ["browser", "windows", "firefox"],
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ["browser", "linux", "chrome"],
    ],
    [
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
      ["browser", "linux", "firefox"],
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ["browser", "other", "safari"],
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      ["browser", "other", "chrome"],
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ["browser", "other", "chrome"],
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Telegram-iOS/11.4",
      ["browser", "other", "other"],
    ],
    ["TelegramBot (like TwitterBot)", ["bot", "other", "other"]],
    ["node", ["cli", "other", "other"]],
    ["curl/8.7.1", ["cli", "other", "other"]],
    ["Wget/1.24.5", ["cli", "other", "other"]],
    [
      "Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.22631; en-US) PowerShell/7.4.6",
      ["cli", "windows", "other"],
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36",
      ["bot", "other", "chrome"],
    ],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", ["bot", "other", "other"]],
    ["SomeTool/1.0", ["other", "other", "other"]],
  ])("labels %s", (ua, labels) => {
    expect(userAgentLabels(ua)).toEqual(labels);
  });

  it("labels a missing header", () => {
    expect(userAgentLabels(null)).toEqual(["none", "other", "other"]);
    expect(userAgentLabels("")).toEqual(["none", "other", "other"]);
  });
});
