import { describe, expect, it } from "vitest";
import source from "../public/theme.js?raw";

/** Runs the theme script with `stored` as the saved choice and the system in `system` mode. */
function run(stored: string | null, system: "light" | "dark", storageFails = false) {
  const classes = new Set(["light"]);
  const root = {
    classList: {
      add: (...names: string[]) => {
        for (const name of names) classes.add(name);
      },
      remove: (...names: string[]) => {
        for (const name of names) classes.delete(name);
      },
    },
    style: { colorScheme: "" },
  };
  const localStorage = {
    getItem: (key: string) => {
      if (storageFails) throw new Error("SecurityError");
      return key === "theme" ? stored : null;
    },
  };
  const matchMedia = (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && system === "dark",
  });
  new Function("document", "localStorage", "matchMedia", source)(
    { documentElement: root },
    localStorage,
    matchMedia,
  );
  return { classes: [...classes], colorScheme: root.style.colorScheme };
}

describe("theme.js", () => {
  it("follows the system setting without a saved choice, or with 'system'", () => {
    expect(run(null, "dark")).toEqual({ classes: ["dark"], colorScheme: "dark" });
    expect(run("system", "light")).toEqual({ classes: ["light"], colorScheme: "light" });
  });

  it("applies the saved choice over the system setting", () => {
    expect(run("light", "dark")).toEqual({ classes: ["light"], colorScheme: "light" });
    expect(run("dark", "light")).toEqual({ classes: ["dark"], colorScheme: "dark" });
  });

  it("follows the system setting when storage can't be read", () => {
    expect(run(null, "dark", true)).toEqual({ classes: ["dark"], colorScheme: "dark" });
  });
});
