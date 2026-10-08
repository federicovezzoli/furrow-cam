# ADR-0002: Next.js + TypeScript as application framework

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Federico Vezzoli
- **Related:** PRD-0001, ADR-0003, ADR-0004

## Context

Furrow CAM is a web application with two distinct halves:

- A rich, interactive client (geometry import, canvas/WebGL editing, toolpath preview) that does all heavy computation (see ADR-0004).
- A thin server that handles authentication and persistence of projects, tools and machine configs (see ADR-0003).

We want one language and one repository for both halves, a large ecosystem, and a low barrier for contributors.

## Options considered

1. **Next.js (App Router) + TypeScript**: full-stack React framework, API routes / server actions colocated with UI, huge ecosystem, familiar to many contributors. Cons: heavier than needed for the CAM workspace itself, server/client component boundary adds complexity.
2. **Vite SPA + separate API (e.g. Fastify/Hono)**: lean client, explicit API boundary. Cons: two apps to wire and deploy, more boilerplate.
3. **SvelteKit / Remix / Nuxt**: comparable full-stack options; smaller contributor pool or less familiarity for the maintainer.

## Decision

We will use **Next.js (App Router) with TypeScript in strict mode** for both the UI and the server-side API.

Guidelines:

- The CAM workspace (editor, preview, toolpath generation) is a **client component tree**. It must not depend on server components to function once a project is loaded.
- Server code (route handlers / server actions) is limited to auth, persistence and validation.
- CAM core logic (geometry, toolpaths, G-code, post-processors) lives in **framework-agnostic TypeScript modules** that do not import React or Next.js, so they can be unit-tested in isolation and run in Web Workers.

## Consequences

- Single repo, single language, single deploy target.
- Contributors familiar with React/Next.js can be productive quickly.
- We must keep the CAM core decoupled from Next.js; this is enforced by module boundaries (to be detailed when the repo structure is set up).
- Self-hosting requires a Node.js runtime (not just static hosting).
