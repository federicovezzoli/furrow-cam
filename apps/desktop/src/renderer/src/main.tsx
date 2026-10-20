import { captureUncaughtErrors, setTelemetrySink } from "@furrow/workspace/lib/telemetry";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { App } from "./app";
import "./styles.css";

// The main process sends them only if the user agreed (ADR-0052).
setTelemetrySink({
  track: (event) => api.trackEvent(event),
  error: ({ name, message, stack }) => api.reportError({ name, message, stack }),
});
captureUncaughtErrors(window);

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
