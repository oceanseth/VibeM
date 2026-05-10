import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/stream": {
        target: "http://localhost:8787",
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
