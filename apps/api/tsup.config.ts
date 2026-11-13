import { defineConfig } from "tsup";
// Workspace packages (@eszy/*) are bundled from source; every other package stays in node_modules.
export default defineConfig({
  entry: { index: "src/index.ts", worker: "src/worker.ts", migrate: "../../packages/db/src/migrate.ts", seed: "../../packages/db/src/seed.ts", "pdf-worker": "src/lib/pdf-worker.ts" }, format: ["esm"], target: "node22", outDir: "dist", clean: true, splitting: false,
  noExternal: [/^@eszy\//],
  external: [/^(?!@eszy\/)(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*(\/.*)?$/],
});
