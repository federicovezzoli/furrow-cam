import { vi } from "vitest";

// Server actions read the request's language (ADR-0054); tests run outside a request, in English.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
