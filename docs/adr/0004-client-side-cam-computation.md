# ADR-0004: CAM computation runs client-side

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001, ADR-0002, ADR-0003

## Context

Toolpath generation (polygon offsetting, pocket clearing, tab insertion, G-code emission) is CPU-intensive and must feel interactive while the user tweaks parameters. We have a server (ADR-0003), so computation could run on either side.

## Options considered

1. **Server-side computation**: central control, but adds latency to every parameter change, scales hosting cost with usage, and requires the network for the core workflow.
2. **Client-side computation**: instant feedback, zero compute cost on the server, server stays a simple storage API.

## Decision

All CAM computation (geometry processing, toolpath generation, simulation, G-code post-processing) runs **in the browser**. Long-running work runs in **Web Workers** so the UI stays responsive.

The server never generates toolpaths or G-code. It stores and validates project documents only.

## Consequences

- Server hosting stays cheap and simple.
- Performance depends on the user's device; we must keep algorithms efficient and may adopt WebAssembly libraries (e.g. Clipper2) where it matters. The geometry library choice gets its own ADR.
- Generated toolpaths and G-code are derived data. They are not stored in the DB and are regenerated from the project document on demand.
- CAM core modules must be framework-agnostic and worker-safe (no DOM, React or Next.js imports), as required by ADR-0002.
