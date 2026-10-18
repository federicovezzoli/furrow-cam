import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

/**
 * Main and preload use only Node built-ins and Electron, so they bundle
 * whatever they import; the renderer is the React app around the shared
 * workspace (ADR-0044).
 */
/**
 * CommonJS: as an ES module, `import … from "electron"` would find the npm
 * package (the binary's path) instead of Electron's API, and a sandboxed
 * preload can't load ES modules at all.
 */
const commonJs = {
  rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
} as const;

export default defineConfig(({ mode }) => ({
  main: { build: commonJs },
  preload: { build: commonJs },
  renderer: {
    plugins: [react(), tailwindcss()],
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    resolve: { dedupe: ["react", "react-dom", "three"] },
    // The workspace's toolpath and simulation workers are ES modules that share chunks.
    worker: { format: "es" },
  },
}));
