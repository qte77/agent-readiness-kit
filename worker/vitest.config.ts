import { defineConfig } from "vitest/config";

// An explicit (even empty) config here stops Vitest's upward config search at this directory —
// without it, `vitest run` inside worker/ walks up and picks up the root's vitest.config.ts,
// which fails to resolve `vitest/config` in CI (the worker job's `npm ci` never installs the
// root's node_modules). Found via CI: https://github.com/qte77/agent-readiness-kit/pull/14.
export default defineConfig({});
