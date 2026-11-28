import { describe, expect, it } from "vitest";
import { programRequests } from "./program-requests";

/** Requests whose answers the test gives, the latest key it sets, and the answers taken. */
function setup() {
  const asked: { key: string; answer: (value: string) => void }[] = [];
  let latest: { key: string } | null = { key: "a" };
  const taken: string[] = [];
  const requests = programRequests(
    (wanted: { key: string }) =>
      new Promise<string>((resolve) => asked.push({ key: wanted.key, answer: resolve })),
    () => latest,
    (wanted, answer) => taken.push(`${wanted.key}:${answer}`),
  );
  return {
    asked,
    taken,
    requests,
    setLatest(key: string | null) {
      latest = key === null ? null : { key };
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("programRequests", () => {
  it("asks once for the latest program, and not for the one played", async () => {
    const { asked, taken, requests } = setup();
    requests.update(null);
    requests.update(null);
    expect(asked.map(({ key }) => key)).toEqual(["a"]);
    asked[0]?.answer("1");
    await settle();
    expect(taken).toEqual(["a:1"]);
    requests.update("a");
    expect(asked).toHaveLength(1);
  });

  it("asks again for the latest when an answer comes for a key no longer wanted", async () => {
    const { asked, taken, requests, setLatest } = setup();
    requests.update(null);
    setLatest("b");
    requests.update(null);
    // Still one in flight.
    expect(asked).toHaveLength(1);
    asked[0]?.answer("1");
    await settle();
    expect(taken).toEqual([]);
    expect(asked.map(({ key }) => key)).toEqual(["a", "b"]);
    asked[1]?.answer("2");
    await settle();
    expect(taken).toEqual(["b:2"]);
  });

  it("waits while nothing is wanted, as toolpaths compute", async () => {
    const { asked, taken, requests, setLatest } = setup();
    requests.update(null);
    setLatest(null);
    asked[0]?.answer("1");
    await settle();
    expect(taken).toEqual([]);
    expect(asked).toHaveLength(1);
    setLatest("c");
    requests.update(null);
    expect(asked.map(({ key }) => key)).toEqual(["a", "c"]);
  });

  it("drops answers after it stops, and asks nothing more", async () => {
    const { asked, taken, requests } = setup();
    requests.update(null);
    requests.stop();
    asked[0]?.answer("1");
    await settle();
    expect(taken).toEqual([]);
    requests.update(null);
    expect(asked).toHaveLength(1);
  });
});
