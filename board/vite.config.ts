import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = fileURLToPath(new URL(".", import.meta.url));

// Builds board/board.html into one self-contained dist/board.html: the HTML is
// injected into a sandboxed iframe, so nothing may be fetched from another URL.
// Mirrors modelcontextprotocol/ext-apps examples/basic-server-vanillajs.
export default defineConfig({
  root,
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    target: "es2022",
    cssMinify: true,
    minify: true,
    rollupOptions: {
      input: resolve(root, "board.html"),
    },
  },
});
