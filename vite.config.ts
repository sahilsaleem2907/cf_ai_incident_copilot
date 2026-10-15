import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Pre-bundled up front: discovering them on first load made Vite reload mid-render (two Reacts, "Invalid hook call").
  optimizeDeps: { include: ["agents/react", "wouter"] },
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({
      auxiliaryWorkers: [{ configPath: "./demo-service/wrangler.jsonc" }],
    }),
  ],
});
