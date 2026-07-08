import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Bind 0.0.0.0 so other devices on the same Wi-Fi can reach the dev
        // server at http://<your-lan-ip>:5173 (not just localhost).
        host: true,
    },
    test: {
        environment: "happy-dom",
        setupFiles: "./setupTest.ts",
        globals: true,
    },
});
