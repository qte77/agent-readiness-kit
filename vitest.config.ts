import { configDefaults, defineConfig } from "vitest/config";

// `worker/` is a separate npm package (own package.json/lockfile/tsconfig, its own CI job) with
// its own vitest run over worker/test/*.test.ts. Without this exclude, vitest's default test
// glob picks up worker/test/*.test.ts here too — harmless when worker/node_modules happens to
// be installed locally, but this repo's root CI job never runs `npm ci` inside worker/, so it
// would fail there trying to resolve @modelcontextprotocol/server. Mirrors the root
// tsconfig.json's `"exclude": [..., "worker"]`.
//
// `dist/**` is also excluded here (found while verifying row 9's `npm run build && node
// dist/src/main.js`): vitest v4's own `configDefaults.exclude` is just
// `["**/node_modules/**", "**/.git/**"]` — it does NOT exclude `dist/` by default. This
// repo's tsconfig.json compiles `test/**/*.ts` too (needed so `tsc --noEmit` typechecks the
// test suite), so any local `npm run build` leaves compiled test files at
// `dist/test/**/*.test.js`; without this exclude, a subsequent `npx vitest run` picks those
// up too and silently double-runs every test. Never surfaces in CI (the `check` job never
// runs `npm run build` before `npm test`), but pollutes any local run after a build.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "worker/**", "dist/**"],
  },
});
