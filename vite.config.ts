import { cloudflare } from "@cloudflare/vite-plugin";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact(), cloudflare()],
  // Reachable from phones on the same Wi-Fi during development.
  server: { host: true },
});
