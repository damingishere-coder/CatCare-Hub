import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
  },
};

export default defineConfig({
  envDir: "..",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: apiProxy,
  },
});
