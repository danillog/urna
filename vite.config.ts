import { defineConfig } from "vitest/config";

import { siteData } from "./site-data";

// The page is index.html plus hashed scripts: the code and the poll data load first, and
// each tab downloads its own data when it opens (see site-data.ts).
export default defineConfig({
  base: "./",
  plugins: [siteData()],
  // A port of its own: browsers keep service workers per origin, so a PWA once served
  // on the default 5173 would keep intercepting this app there.
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
  build: {
    target: "es2022",
    reportCompressedSize: true,
    // Data pieces are large by design; the warning is about code.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "jsdom",
    include: ["tests/web/**/*.test.ts", "tests/worker/**/*.test.ts"],
  },
});
