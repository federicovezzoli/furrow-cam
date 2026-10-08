# ADR-0010: Client state management with Zustand and Immer

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** ADR-0002, ADR-0003, ADR-0004, ADR-0008, ADR-0009

## Context

The CAM workspace holds several kinds of client state with different lifecycles:

- **Project document**: stock, imported geometry, tools snapshot, operations (ADR-0003). Edited by the user, must support **undo/redo**, autosaved to the server.
- **UI/session state**: selection, hover, active panel, camera, viewport mode. Not undoable, not saved (or saved only as user preferences).
- **Derived data**: toolpaths and G-code, computed in Web Workers (ADR-0004) from the document. Cached, never saved, never undoable.
- **Server data**: project list, tool library, machine profiles, user account.

Requirements:

- Undo/redo of document edits, where a continuous gesture (e.g. dragging a shape, scrubbing a numeric input) is **one** undo step.
- The three.js viewport (ADR-0008) must read state in per-frame code **without triggering React re-renders**.
- Low boilerplate; easy to inspect state while debugging.

## Options considered

1. **Redux Toolkit**: well known, strong conventions, excellent DevTools, Immer built in. Cons: more ceremony (slices, actions, provider); per-frame transient reads are possible via `store.getState()` but less idiomatic.
2. **Zustand**: minimal hook-based stores, selectors, `getState()`/`subscribe()` for transient reads outside React, middleware for Immer and Redux DevTools. Same ecosystem (pmndrs) as React Three Fiber. Cons: no enforced structure, so conventions must be defined by us.
3. **Jotai / Valtio**: atom- or proxy-based; good for fine-grained UI state, less natural for a single undoable document.
4. **React context + useReducer**: no extra dependency, but re-render performance and undo would be hand-built.

## Decision

Use **Zustand** with the **Immer** and **devtools** middlewares, organized as follows.

### Stores

| Store | Contents | Undoable | Persisted |
| --- | --- | --- | --- |
| `useDocumentStore` | The project document (matches the Zod schema of ADR-0003) | Yes | Yes, autosave to server |
| `useWorkspaceStore` | Selection, hover, active tool/panel, viewport mode, camera | No | No (selected preferences may be saved per user) |
| `useToolpathStore` | Toolpath results and status per operation, keyed by a hash of the operation's inputs | No | No |

Server data (project list, tool library, machine profiles) is fetched via the Next.js server layer and is **not** duplicated in Zustand, except the project document currently open.

### Undo/redo

- Document mutations go through Immer's **patches** (`produceWithPatches`): every committed change records forward and inverse patches on an undo stack.
- Continuous gestures use **transactions** (`beginTransaction` / `commitTransaction`): intermediate updates are applied live but merged into a single undo entry on commit.
- Only `useDocumentStore` participates in undo. Selection changes and camera moves never pollute the undo history.

### Conventions

- All state changes go through **named actions defined in the store**; components never call `setState` directly.
- Components read state through **narrow selectors** (`useDocumentStore(s => s.operations)`), never the whole store.
- Per-frame and pointer-move code in the viewport uses `getState()` / `subscribe()` instead of hooks.
- Workers receive **plain snapshots** of the needed document parts (structured clone); results are written back to `useToolpathStore`. Workers never access stores directly.
- Autosave subscribes to `useDocumentStore`, debounces, and sends the document to the server; it never runs mid-transaction.

## Consequences

- Little boilerplate; stores are plain TypeScript and testable without React.
- Undo/redo is generic: any document action is undoable without writing inverse logic by hand.
- Familiar debugging via Redux DevTools.
- Because Zustand does not enforce structure, the conventions above must be followed in code review.
- Immer patches assume the document is plain, serializable data, which the Zod schema already guarantees.
