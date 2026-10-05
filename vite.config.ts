import { viteSingleFile } from "vite-plugin-singlefile";
import { defineConfig } from "vitest/config";

// The page ships as one self-contained dist/index.html: scripts, styles and
// data are inlined so it can be uploaded anywhere and still work offline.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  // A port of its own: browsers keep service workers per origin, so a PWA once served
  // on the default 5173 would keep intercepting this app there.
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
  build: { target: "es2022", reportCompressedSize: true },
  test: {
    environment: "jsdom",
    include: ["tests/web/**/*.test.ts", "tests/worker/**/*.test.ts"],
  },
});
