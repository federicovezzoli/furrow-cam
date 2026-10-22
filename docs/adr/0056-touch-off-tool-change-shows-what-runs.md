# ADR-0056: The touch-off pad's tool change is always a block, and the field shows it

- **Status:** Proposed
- **Date:** 2026-10-22
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0002 (Z11), PRD-0005 (S12), ADR-0041, ADR-0043, ADR-0053; #284. Supersedes ADR-0043's *Its own tool change* bullet where `TouchOff.toolChange` is `null` and where it describes the field's buttons, and the part of ADR-0041's *GRBL post* bullet that moves over the pad before the machine's block.

## Context

With a touch-off pad, `TouchOff.toolChange` has two modes (ADR-0043). A custom block runs as written. With `null`, the post rapids to safe Z and over the pad, then writes the machine's `toolChange` block or the default pause (ADR-0041). The zero section shows neither: its text area is empty with the machine's block as a grey placeholder, so the field always looks filled, and the hint can only describe the `null` mode in words. Users can't tell what will run at a tool change.

The move over the pad before the machine's block is also wasted when the block moves on its own (ADR-0043's context): that's what **Suggest** fixes, but only when the user presses it.

## Decision

- **One block:** with a pad, a tool change always writes one block, its placeholders filled in: the project's own, or with `null` the one derived from the machine's, `suggestTouchOffToolChange(machine.toolChange)` (ADR-0053), which for a machine without a block is the default pause with the move over the pad. The separate move over the pad before the machine's block goes. Since the derivation now runs on every export, it handles a block in inches: the placeholders are in millimetres, so a pad move written in place of the block's own move sets `G21` and restores `G20` after it, as it already set `G90` and restored `G91`.
- **The field shows it:** the text area's value is the block that runs. Editing it saves the project's own block; clearing it goes back to the derived one. No schema change and no migration: existing `null` pads show their derived block.
- **Reset:** **Suggest** and **Use the machine's** become one **Reset**, shown only when the block is the project's own, which sets it back to `null`.
- **Hint:** one sentence, "Runs at each tool change.", followed by the placeholder list (`PLACEHOLDERS`).
- **The bit's name:** the derived default pause is the same for every bit, `M0 (Change the bit and zero Z on the touch-off pad)`, so it no longer names the bit. The `(Tool: …)` comment the post writes just before the tool change names it; no `{tool}` placeholder is added.

## Consequences

- What the field shows is what's exported, for every pad project.
- Exported G-code changes for pad projects without a custom block: a machine block that moves now has its move put on the pad, rather than a move over the pad before it; with no machine block, the pause's comment loses the bit's name.
- A machine whose block changes later updates every pad project still on `null`, as before; a project's own block doesn't follow it.
