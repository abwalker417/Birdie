import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      cleanupOutdatedCaches: true,
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: "Birdie Golf Tracker",
        short_name: "Birdie",
        display: "standalone",
        start_url: "/",
        theme_color: "#163823",
        background_color: "#0a1f12"
      }
    })
  ],
  server: { proxy: { "/api": "http://localhost:8000" } }
})
