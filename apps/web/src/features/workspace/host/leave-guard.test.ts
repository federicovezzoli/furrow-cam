import { describe, expect, it } from "vitest";
import { createLeaveGuard } from "./leave-guard";

/** A browser history of paths, each with its state, and the guard on it. */
function setup(answer: boolean, entries = ["/projects", "/projects/p"]) {
  const stack = entries.map((path) => ({ path, state: null as unknown }));
  let index = stack.length - 1;
  let asked = 0;
  let unsaved = false;
  const history = {
    pushState(state: unknown) {
      stack.splice(index + 1, Infinity, { path: stack[index]?.path ?? "", state });
      index++;
    },
    back() {
      index--;
      guard.popState();
    },
    get state() {
      return stack[index]?.state;
    },
  };
  const guard = createLeaveGuard({
    history: () => history,
    pathname: () => stack[index]?.path ?? "",
    inProject: (path) => path.startsWith("/projects/p"),
    // As `mayLeave`: asks only while the changes can't be saved.
    confirmLeave: () => {
      if (!unsaved) return true;
      asked++;
      return answer;
    },
  });
  /** What autosave reports, passed on to the guard. */
  const setUnsaved = (value: boolean) => {
    unsaved = value;
    guard.setUnsaved(value);
  };
  /** The browser's Back button. */
  const back = () => history.back();
  /** Following a link to `path`, as the router pushes it. */
  const open = (path: string) => {
    stack.splice(index + 1, Infinity, { path, state: null });
    index++;
  };
  return { setUnsaved, back, open, at: () => stack[index]?.path, asked: () => asked, stack };
}

describe("createLeaveGuard", () => {
  it("lets Back through while the changes are saved", () => {
    const { setUnsaved, back, at, asked } = setup(false);
    setUnsaved(false);
    back();
    expect(at()).toBe("/projects");
    expect(asked()).toBe(0);
  });

  it("asks before Back leaves unsaved changes, and stays when told to", () => {
    const { setUnsaved, back, at, asked, stack } = setup(false);
    setUnsaved(true);
    back();
    expect(asked()).toBe(1);
    expect(at()).toBe("/projects/p");
    // Armed again: the next Back asks too.
    back();
    expect(asked()).toBe(2);
    expect(at()).toBe("/projects/p");
    expect(stack).toHaveLength(3);
  });

  it("goes back past the copy when told to leave", () => {
    const { setUnsaved, back, at, asked } = setup(true);
    setUnsaved(true);
    back();
    expect(asked()).toBe(1);
    expect(at()).toBe("/projects");
  });

  it("goes straight back once saves went through again", () => {
    const { setUnsaved, back, at } = setup(false);
    setUnsaved(true);
    setUnsaved(false);
    back();
    expect(at()).toBe("/projects");
  });

  it("asks only when Back leaves the copy, not when it lands on it from another project page", () => {
    const { setUnsaved, back, open, at, asked } = setup(true);
    setUnsaved(true);
    open("/projects/p/simulate");
    back();
    expect(at()).toBe("/projects/p");
    expect(asked()).toBe(0);
    back();
    expect(asked()).toBe(1);
    expect(at()).toBe("/projects");
  });

  it("guards again when going back lands on another of the project's pages", () => {
    const { setUnsaved, back, at, asked, stack } = setup(true, [
      "/projects",
      "/projects/p",
      "/projects/p/simulate",
    ]);
    setUnsaved(true);
    back();
    expect(at()).toBe("/projects/p");
    expect(asked()).toBe(1);
    // The project's workspace page has a copy of its own now.
    expect(stack.at(-1)?.state).toEqual({ furrowLeaveGuard: true });
  });
});
