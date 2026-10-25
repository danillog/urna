import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The interactive page: every motion in a Player, with its controls.
export default defineConfig({
  root: here("./interativo"),
  base: "./",
  build: { outDir: here("./dist"), emptyOutDir: true },
  // Data and models come from the site's folders, one level up.
  server: { fs: { allow: [here("..")] } },
});
