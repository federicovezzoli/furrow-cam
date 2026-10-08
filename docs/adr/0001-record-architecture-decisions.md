# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli

## Context

Furrow CAM is a new open source project expected to receive contributions from people who were not present when key choices were made. CAM software involves many non-obvious trade-offs (geometry kernels, numeric precision, toolpath algorithms, G-code dialects). Without a record, these decisions get re-debated or silently reversed.

## Decision

We will record significant architectural decisions as ADRs in `docs/adr/`, using the template and process described in [`README.md`](README.md).

A decision is "significant" if it affects structure, dependencies, interfaces, data formats, or is costly to reverse.

## Consequences

- New contributors can learn *why* the system looks the way it does.
- Changing a decision requires a new ADR, which makes the reversal deliberate and visible.
- Small overhead per decision. We accept this.
