import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_LOCAL_API_PROXY_TARGET ?? "http://127.0.0.1:8000";
const apiProxy = {
  "/api": {
    target: apiTarget,
  },
};

export default defineConfig({
  root: "public-entry",
  envDir: "..",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-public",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    proxy: apiProxy,
    fs: { allow: [".."] },
  },
  preview: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    proxy: apiProxy,
  },
});
