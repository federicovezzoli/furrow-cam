import { TERRAIN_HOSTS } from "@furrow/workspace/lib/terrain-services";

/**
 * Whether the window may send `url` while the terrain dialog is open
 * (ADR-0076): a `GET` over HTTPS to one of `TERRAIN_HOSTS`, on the default port.
 */
export function isTerrainRequest(url: string, method: string): boolean {
  if (method !== "GET") return false;
  try {
    const { protocol, hostname, port } = new URL(url);
    return (
      protocol === "https:" &&
      port === "" &&
      (TERRAIN_HOSTS as readonly string[]).includes(hostname)
    );
  } catch {
    return false;
  }
}
