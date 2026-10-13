# PRD-0004: Machine presets

- **Status:** Draft
- **Author:** Federico Vezzoli
- **Created:** 2026-10-13
- **Related:** PRD-0001 (R19), PRD-0003, ADR-0003

## Problem

Before exporting their first G-code, users must create a machine profile (PRD-0001 **R19**) with about ten technical values: work area, maximum feeds, spindle speed range, safe Z, entry clearance, post-processor and optional custom G-code. Beginners often don't know these values, and getting them wrong means failed or unsafe cuts.

Many hobby routers come from a handful of communities with well-documented machines: V1 Engineering (LowRider, MPCNC), Maslow, Sienci (LongMill) and SainSmart (Genmitsu). None of them ships its own CAM: users are pointed to a sender (Candle, UGS, the FluidNC web UI) plus a third-party CAM (Easel, Carveco, Fusion). Presets for these machines make Furrow CAM the obvious free, browser-based CAM for each community and shorten onboarding to a few clicks.

## Users

- Owners of a specific hobby router who are new to CAM, arriving from that machine's community (forums, docs, videos).
- Experienced users who want a sensible starting point instead of typing every value.

## Goals

- A user creates a correct machine profile for a supported machine in under a minute.
- Every preset value is traceable to an official source.
- Presets never lock users in: the result is an ordinary, editable machine.

## Non-goals

- **Controllers without a compatible post-processor**, e.g. MPCNC or LowRider builds running Marlin, or Masso-based machines. Only GRBL-compatible firmware (GRBL, grblHAL, FluidNC) is in scope until other post-processors exist.
- **Travel or soft-limit checks** against the machine's work area (relevant for Maslow; see PRD-0002 non-goals).
- **Bit (tool) presets** for the same communities: a natural follow-up, in a separate PRD.
- **Linked presets:** later changes to a preset don't update machines already created from it.
- Sending G-code to the machine (PRD-0001 non-goal).

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| M1 | A catalog of machine presets lives in the repository (versioned with the code, reviewed through PRs), not in the database. Each preset has: maker, model, variant (e.g. size), supported controller firmware, values for the `Machine` fields, notes, and source URLs for its values | Must |
| M2 | First round: V1 Engineering **LowRider v4** and **MPCNC Primo**, **Maslow 4**, Sienci **LongMill MK2**, SainSmart **Genmitsu 3018** (variants decided while researching each machine) | Must |
| M3 | **No guessed values:** every value comes from official documentation (maker docs, product pages, firmware configs) with its source in the catalog. A value with no official source is left empty in the preset, and the user is asked to fill it in | Must |
| M4 | **Build-to-size machines** (LowRider, MPCNC) have no default work area: the preset asks for the user's build dimensions, with a short explanation of how to measure them | Must |
| M5 | Picking a preset creates an ordinary machine in the user's library, pre-filled from the preset and fully editable, with the model name as its default name | Must |
| M6 | The **New machine** page offers "Start from a preset" (grouped by maker, searchable) or "Start from scratch" | Must |
| M7 | Each preset states its required firmware; the picker shows it, e.g. "Requires FluidNC (Jackpot board) or GRBL. Marlin builds aren't supported yet" | Must |
| M8 | Preset notes are shown when picking it, e.g. manual trim-router spindle, or for Maslow: keep the job inside the frame, the firmware doesn't enforce limits | Must |
| M9 | A new user with no machines is offered the preset picker when they first need a machine (e.g. before their first export) | Should |
| M10 | Machines created from a preset count towards the machine limit when freemium limits are on (PRD-0003) | Must |
| M11 | Tests check that every preset is valid against the `Machine` schema (with sample values for user-provided fields) and lists at least one source | Must |

## User flow

1. A LowRider v4 owner signs up and clicks **New machine**.
2. They pick **V1 Engineering → LowRider v4**. The page explains it needs a FluidNC (Jackpot) or GRBL controller and asks for the build's X/Y working area.
3. They enter their dimensions; the remaining values are pre-filled from V1 Engineering's documentation. They save.
4. In their first project they select the machine and export G-code that runs on their LowRider without edits.

## Success criteria

- For each first-round machine, a profile created from the preset (plus the user's build size where needed) produces G-code that runs on that machine without manual edits.
- Every value in the catalog links to a source a reviewer can check.

## Open questions

- Which variants to include for each machine (e.g. LongMill sizes, Genmitsu 3018 revisions): decided per machine while researching its sources.

## Changelog

- 2026-10-13: initial draft
