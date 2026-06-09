import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  packages: "external"
});
