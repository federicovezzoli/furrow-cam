"use client";

import type * as React from "react";
import { createContext, useContext } from "react";
import type { WorkspaceHost } from "../lib/workspace-host";

const HostContext = createContext<WorkspaceHost | null>(null);

/** Gives the workspace below it `host` to save, load and navigate through (ADR-0045). */
export function WorkspaceHostProvider({
  host,
  children,
}: {
  host: WorkspaceHost;
  children: React.ReactNode;
}) {
  return <HostContext value={host}>{children}</HostContext>;
}

export function useWorkspaceHost(): WorkspaceHost {
  const host = useContext(HostContext);
  if (!host) throw new Error("useWorkspaceHost used outside WorkspaceHostProvider");
  return host;
}
