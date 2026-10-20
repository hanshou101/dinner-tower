import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const boardDir = fileURLToPath(new URL(".", import.meta.url));
const harnessDir = resolve(boardDir, "test/harness");

// Builds the test-only host harness (test/harness/harness.html) into one file
// so the fixture server can serve it with a single sendFile.
export default defineConfig({
  root: harnessDir,
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(harnessDir, "dist"),
    emptyOutDir: true,
    target: "es2022",
    cssMinify: true,
    minify: true,
    rollupOptions: {
      input: resolve(harnessDir, "harness.html"),
    },
  },
});
