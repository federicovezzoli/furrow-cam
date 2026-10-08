# ADR-0009: UI components with shadcn/ui and Tailwind CSS

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0002, ADR-0008

## Context

Besides the 3D/2D viewport (ADR-0008), Furrow CAM needs a lot of application UI: a panel layout around the canvas, property forms for stock, tools and operations, lists and trees, menus, dialogs, a tool library manager, and account pages.

CAM UIs are **dense, desktop-like and keyboard-heavy**, unlike typical web apps. The UI layer must be accessible, themeable (light/dark), and easy to customize deeply.

## Options considered

1. **shadcn/ui + Tailwind CSS (Radix primitives)**: components are copied into the repo and fully owned; accessible primitives; includes resizable panels, command palette, context menu, menubar. Cons: spacious defaults; some domain components missing.
2. **Mantine**: large component set including number inputs and trees. Cons: its own styling system, heavier to restyle deeply.
3. **Blueprint**: designed for dense desktop-like apps. Cons: dated look, strong visual lock-in.
4. **MUI**: comprehensive. Cons: heavy, Material look poorly suited to a tool UI, deep customization is costly.

## Decision

- Use **shadcn/ui** components on **Tailwind CSS**, with Radix primitives.
- Define a **compact density scale** from the start (smaller control heights, font sizes and spacing) via theme tokens, instead of the default spacing.
- Support **light and dark themes** through CSS variables.
- Build these **domain components** in-house on top of the primitives:
  - **Unit-aware numeric input**: accepts values with units and simple expressions (e.g. `1/4in`, `6.35mm`, `10/2`), converts to project units, supports arrow-key steps and drag-to-scrub.
  - **Tree view** for operations and layers/shapes, with reordering.
  - **Keyboard shortcut system** for global and context-specific commands.
- Form state and validation reuse the **Zod schemas** of the project document (ADR-0003).

## Consequences

- Full control over component code and styling; no fight with a library's design system.
- Upgrading shadcn components is manual (re-generate and merge), which we accept.
- Upfront effort on density tokens and the numeric input; these are core to usability and worth doing early.
