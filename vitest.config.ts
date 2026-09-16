import { configDefaults, defineConfig } from "vitest/config";

// `worker/` is a separate npm package (own package.json/lockfile/tsconfig, its own CI job) with
// its own vitest run over worker/test/*.test.ts. Without this exclude, vitest's default test
// glob picks up worker/test/*.test.ts here too — harmless when worker/node_modules happens to
// be installed locally, but this repo's root CI job never runs `npm ci` inside worker/, so it
// would fail there trying to resolve @modelcontextprotocol/server. Mirrors the root
// tsconfig.json's `"exclude": [..., "worker"]`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "worker/**"],
  },
});
