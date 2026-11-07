import { createProjectDocument } from "@furrow/document";
import { DialogsProvider } from "@furrow/ui/components/dialogs";
import { LocaleProvider } from "@furrow/ui/components/locale-provider";
import { TooltipProvider } from "@furrow/ui/components/ui/tooltip";
import { cleanup, render } from "@testing-library/react";
import type * as React from "react";
import { afterEach } from "vitest";
import { createMemoryHost } from "./lib/memory-host";
import type { WorkspaceHost } from "./lib/workspace-host";
import { WorkspaceHostProvider } from "./providers/workspace-host";
import { WorkspaceStoresProvider } from "./providers/workspace-stores";

// Without Vitest globals, Testing Library can't unmount between tests itself.
afterEach(cleanup);

/**
 * Renders `ui` as the workspace sees it, for component tests (`*.test.tsx`
 * with `// @vitest-environment jsdom`): in English, with dialogs, tooltips
 * (which the ribbon provides) and the stores of `host`, by default an in-memory host with an empty project.
 */
export function renderWorkspace(
  ui: React.ReactElement,
  host: WorkspaceHost = createMemoryHost({ document: createProjectDocument() }),
) {
  return render(
    <LocaleProvider locale="en" onLocaleChange={() => {}}>
      <DialogsProvider>
        <WorkspaceHostProvider host={host}>
          <WorkspaceStoresProvider>
            <TooltipProvider>{ui}</TooltipProvider>
          </WorkspaceStoresProvider>
        </WorkspaceHostProvider>
      </DialogsProvider>
    </LocaleProvider>,
  );
}
