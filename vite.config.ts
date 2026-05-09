import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
});
