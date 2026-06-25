import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Expose env vars to the client under import.meta.env
    // All env vars must be prefixed with VITE_ in .env files
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: "ES2022",
  },
});
