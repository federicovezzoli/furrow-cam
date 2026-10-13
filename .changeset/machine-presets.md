---
"@furrow/document": minor
"@furrow/web": minor
---

Machine presets (PRD-0004). `@furrow/document` adds `MACHINE_PRESETS`, a catalog of popular hobby routers whose values all come from official documentation with their sources: V1 Engineering LowRider v4 and MPCNC Primo (build-to-size, with V1 Engineering's Jackpot G-code), Maslow 4, Sienci LongMill MK2 (12x30, 30x30, 48x30) and SainSmart Genmitsu 3018 REX and PROVer V2. Values no official source states are asked of the user, and conflicting official values resolve to the most conservative one. It also adds `presetMachine`, `presetName`, `askedFields` and `NEW_MACHINE_DEFAULTS`. The New machine page offers "Start from a preset" (grouped by maker, searchable), showing the preset's firmware, notes, what to fill in and its sources, then pre-filling the form, or "Start from scratch". The projects page points users without a machine there.
