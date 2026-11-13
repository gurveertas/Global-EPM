import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// In development open http://demo.localhost:5173 for the demo company and http://admin.localhost:5173 for the platform console.
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    allowedHosts: true,
    // Inside Docker the API is reachable as http://api:4000 (see docker-compose.dev.yml).
    proxy: { "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:4000", changeOrigin: false, xfwd: true } },
    watch: process.env.CHOKIDAR_USEPOLLING === "true" ? { usePolling: true, interval: 300 } : undefined,
  },
});
