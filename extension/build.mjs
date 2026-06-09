import fs from "node:fs/promises";
import { build } from "esbuild";

await fs.mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/contentScript.ts"],
  outfile: "dist/contentScript.js",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true
});

await build({
  entryPoints: ["src/background.ts"],
  outfile: "dist/background.js",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true
});

await fs.copyFile("manifest.json", "dist/manifest.json");
await fs.copyFile("src/styles.css", "dist/styles.css");
