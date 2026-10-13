import { describe, expect, it } from "vitest";
import { lazyWorker } from "./lazy-worker";

/** Just enough of a `Worker` to drive its handlers by hand. */
class FakeWorker {
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  fail(message = "") {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const messages: string[] = [];
  const failures: string[] = [];
  const worker = lazyWorker<string, string>(
    () => {
      const created = new FakeWorker();
      workers.push(created);
      return created as unknown as Worker;
    },
    {
      onMessage: (message) => messages.push(message),
      onFail: (error) => failures.push(error),
      failures: { stopped: "Stopped", unreadable: "Unreadable" },
    },
  );
  return { worker, workers, messages, failures };
}

describe("lazyWorker", () => {
  it("starts the worker on the first post and reuses it", () => {
    const { worker, workers, messages } = setup();
    expect(workers).toHaveLength(0);
    worker.post("a");
    worker.post("b");
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toEqual(["a", "b"]);
    workers[0]?.onmessage?.({ data: "done" } as MessageEvent);
    expect(messages).toEqual(["done"]);
  });

  it("drops a failed worker and starts another only on the next post", () => {
    const { worker, workers, failures } = setup();
    worker.post("a");
    workers[0]?.fail();
    expect(failures).toEqual(["Stopped"]);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers).toHaveLength(1);

    worker.post("b");
    expect(workers).toHaveLength(2);
    workers[1]?.fail("Out of memory");
    workers[1]?.onmessageerror?.();
    expect(failures).toEqual(["Stopped", "Out of memory", "Unreadable"]);
  });

  it("terminates", () => {
    const { worker, workers } = setup();
    worker.terminate();
    worker.post("a");
    worker.terminate();
    expect(workers[0]?.terminated).toBe(true);
  });
});
