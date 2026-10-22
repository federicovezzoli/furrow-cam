import { describe, expect, it } from "vitest";
import { createLeaveGuard } from "./leave-guard";

/**
 * A browser history of paths and the guard on it. A path starting with `!`
 * is another document's entry; `navigation` is false for a browser without
 * the Navigation API.
 */
function setup(answer: boolean, entries = ["/projects", "/projects/p"], navigation = true) {
  const stack = entries.map((entry) => ({
    path: entry.replace(/^!/, ""),
    sameDocument: !entry.startsWith("!"),
  }));
  let index = stack.length - 1;
  let asked = 0;
  let unsaved = false;
  /** A traversal by `delta` entries, as the browser fires `popstate` after it. */
  const go = (delta: number) => {
    index += delta;
    guard.popState();
  };
  const history = {
    pushState() {
      stack.splice(index + 1, Infinity, { path: stack[index]?.path ?? "", sameDocument: true });
      index++;
    },
    back: () => go(-1),
    go,
  };
  const guard = createLeaveGuard({
    history: () => history,
    navigation: () =>
      navigation
        ? {
            currentEntry: { index },
            entries: () =>
              stack.map(({ path, sameDocument }) => ({
                url: `https://furrow.test${path}`,
                sameDocument,
              })),
          }
        : undefined,
    pathname: () => stack[index]?.path ?? "",
    inProject: (path) => path.startsWith("/projects/p"),
    // As `mayLeave`: asks only while the changes can't be saved, answering later.
    confirmLeave: () => {
      if (!unsaved) return true;
      asked++;
      return Promise.resolve(answer);
    },
  });
  /** What autosave reports, passed on to the guard. */
  const setUnsaved = (value: boolean) => {
    unsaved = value;
    guard.setUnsaved(value);
  };
  /** Following a link to `path`, as the router pushes it. */
  const open = (path: string) => {
    stack.splice(index + 1, Infinity, { path, sameDocument: true });
    index++;
  };
  return {
    setUnsaved,
    /** Waits for the user's answer to be acted on. */
    answered: () => new Promise((resolve) => setTimeout(resolve)),
    back: history.back,
    go,
    open,
    at: () => stack[index]?.path,
    asked: () => asked,
    stack,
  };
}

describe("createLeaveGuard", () => {
  it("lets Back through while the changes are saved", () => {
    const { setUnsaved, back, at, asked } = setup(false);
    setUnsaved(false);
    back();
    expect(at()).toBe("/projects");
    expect(asked()).toBe(0);
  });

  it("asks before Back leaves unsaved changes, and stays when told to", async () => {
    const { setUnsaved, back, answered, at, asked, stack } = setup(false);
    setUnsaved(true);
    back();
    expect(asked()).toBe(1);
    await answered();
    expect(at()).toBe("/projects/p");
    // Armed again: the next Back asks too.
    back();
    expect(asked()).toBe(2);
    await answered();
    expect(at()).toBe("/projects/p");
    expect(stack).toHaveLength(3);
  });

  it("goes back past the copy when told to leave", async () => {
    const { setUnsaved, back, answered, at, asked } = setup(true);
    setUnsaved(true);
    back();
    expect(asked()).toBe(1);
    await answered();
    expect(at()).toBe("/projects");
  });

  it("goes straight back once saves went through again", () => {
    const { setUnsaved, back, at } = setup(false);
    setUnsaved(true);
    setUnsaved(false);
    back();
    expect(at()).toBe("/projects");
  });

  it("asks only when Back leaves the copy, not when it lands on it from another project page", async () => {
    const { setUnsaved, back, answered, open, at, asked } = setup(true);
    setUnsaved(true);
    open("/projects/p/simulate");
    back();
    expect(at()).toBe("/projects/p");
    expect(asked()).toBe(0);
    back();
    expect(asked()).toBe(1);
    await answered();
    expect(at()).toBe("/projects");
  });

  it("lets Back through to another of the project's pages, then guards there", async () => {
    const { setUnsaved, back, answered, at, asked, stack } = setup(false, [
      "/projects",
      "/projects/p",
      "/projects/p/simulate",
    ]);
    setUnsaved(true);
    // No copy on the simulator: Back from it stays in the project.
    expect(stack).toHaveLength(3);
    back();
    expect(at()).toBe("/projects/p");
    expect(asked()).toBe(0);
    // The project's workspace page has a copy of its own now.
    expect(stack).toHaveLength(3);
    expect(stack.at(-1)?.path).toBe("/projects/p");
    back();
    expect(asked()).toBe(1);
    await answered();
    expect(at()).toBe("/projects/p");
  });

  it("does nothing once Back left the project while asking", async () => {
    const { setUnsaved, back, answered, at, stack } = setup(true);
    setUnsaved(true);
    back();
    // Back again before answering: out of the project already.
    back();
    await answered();
    expect(at()).toBe("/projects");
    expect(stack).toHaveLength(3);
  });

  it("goes back when told to leave, even if saves failed again while asking", async () => {
    const { setUnsaved, back, answered, at, asked } = setup(true);
    setUnsaved(true);
    back();
    // A retry failed again while the dialog was open: no new copy goes on, so one answer leaves.
    setUnsaved(true);
    await answered();
    expect(asked()).toBe(1);
    expect(at()).toBe("/projects");
  });

  it("leaves when told to after Forward while asking", async () => {
    const { setUnsaved, back, go, answered, at, asked } = setup(true);
    setUnsaved(true);
    back();
    // Forward onto the copy before answering.
    go(1);
    await answered();
    expect(asked()).toBe(1);
    expect(at()).toBe("/projects");
  });

  it("stays guarded when told to stay after Forward while asking", async () => {
    const { setUnsaved, back, go, answered, at, asked, stack } = setup(false);
    setUnsaved(true);
    back();
    go(1);
    await answered();
    expect(at()).toBe("/projects/p");
    expect(stack).toHaveLength(3);
    // Back from the copy lands on the page and asks at once.
    back();
    expect(asked()).toBe(2);
  });

  it("neither asks nor arms when Back skips past the project", () => {
    const { setUnsaved, go, at, asked, stack } = setup(false);
    setUnsaved(true);
    go(-2);
    expect(at()).toBe("/projects");
    expect(asked()).toBe(0);
    expect(stack).toHaveLength(3);
  });

  it("leaves Back to beforeunload when the previous entry isn't this document's", () => {
    for (const entries of [["/projects/p"], ["!/projects", "/projects/p"]]) {
      const { setUnsaved, stack } = setup(false, entries);
      setUnsaved(true);
      expect(stack).toHaveLength(entries.length);
    }
  });

  it("does nothing without the Navigation API", () => {
    const { setUnsaved, back, at, stack } = setup(false, undefined, false);
    setUnsaved(true);
    expect(stack).toHaveLength(2);
    back();
    expect(at()).toBe("/projects");
  });
});
