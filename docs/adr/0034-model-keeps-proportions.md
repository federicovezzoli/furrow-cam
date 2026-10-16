# ADR-0034: Models keep their proportions and are cut off at the stock's bottom

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0005 (S2, S3), ADR-0030, ADR-0031

## Context

ADR-0031 scales a model's outline and sets its depth on its own, stretching or squashing the mesh in Z, and caps a new model's depth at the stock's thickness. A relief imported into a thin stock came out flattened. Making the stock thicker kept it flat, and changing the model's width or length left its depth alone, so the relief looked stretched. Users expect a model to keep the shape it was modelled with.

## Decision

- **One scale:** the width, length and depth fields scale the model the same in all three directions. Importing, *Fit to stock*, turning and every size field set the depth to the rotated mesh's height times the scale (`proportionalDepth`). The stored `depth` stays in the document, so models placed before keep their depth until edited, and toolpaths still read it.
- **No cap on import:** a new model takes the depth its scale gives, even deeper than the stock. The model's properties say so.
- **Cut off at the stock's bottom:** 3D operations get the stock's bottom in their toolpath input and cut no deeper than it, with a warning. Finishing follows the model above it; roughing's last level is there.

This supersedes ADR-0031 in part: depth is no longer set independently of the scale, and import no longer caps it.

## Consequences

- A model looks as it was modelled, at any size.
- Fitting a model's depth to the stock scales its outline down too. A relief taller than the stock is either scaled down or cut off at the bottom.
- Changing the stock's thickness recomputes 3D toolpaths.
