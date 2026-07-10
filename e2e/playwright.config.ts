import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const APP_DIR = path.resolve(__dirname, "../app");
const PORT = 5400;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run dev",
    cwd: APP_DIR,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Dummy Supabase config so `hasSupabaseConfig` is true and the app boots
    // past the config guard. The test seeds a fake session in localStorage and
    // mocks every /api call + the realtime WebSocket, so no real backend is hit.
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
