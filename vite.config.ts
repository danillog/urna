import { viteSingleFile } from "vite-plugin-singlefile";
import { defineConfig } from "vitest/config";

// The page ships as one self-contained dist/index.html: scripts, styles and
// data are inlined so it can be uploaded anywhere and still work offline.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: { target: "es2022", reportCompressedSize: true },
  test: {
    environment: "jsdom",
    include: ["tests/web/**/*.test.ts"],
  },
});
