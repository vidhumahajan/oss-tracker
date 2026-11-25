import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // While developing, the React app runs on port 5173 and the API on 4000.
    // This forwards every /api request to the API, so the browser only ever
    // talks to one address. That keeps login cookies simple and means we
    // need no CORS setup at all.
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
