/**
 * The one Node global the workspace reads: bundlers (Next.js, Vite) replace
 * `process.env.NODE_ENV` at build time, so the package needs no Node types.
 */
declare const process: { env: { NODE_ENV?: string } };
