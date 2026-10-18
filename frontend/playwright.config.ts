import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const frontendDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryDatabaseDirectory = process.env.APISENTINEL_PLAYWRIGHT_TEMP_DIR;
if (
  !temporaryDatabaseDirectory ||
  dirname(resolve(temporaryDatabaseDirectory)) !== resolve(tmpdir()) ||
  !basename(temporaryDatabaseDirectory).startsWith("apisentinel-playwright-")
) {
  throw new Error("Run browser tests with npm run test:e2e to configure a safe temporary database.");
}

const temporaryDatabasePath = join(temporaryDatabaseDirectory, "browser-tests.sqlite3");
if (process.env.DATABASE_URL !== `sqlite:///${temporaryDatabasePath}`) {
  throw new Error("Playwright DATABASE_URL must point to its generated temporary SQLite database.");
}

const backendPort = 8001;
const frontendPort = 5173;
const openmpDirectory = join(projectRoot, "vendor", "libomp");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    browserName: "chromium",
    channel: "chrome",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: `DYLD_LIBRARY_PATH="${openmpDirectory}" ../.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${backendPort} --log-level error`,
      cwd: join(projectRoot, "backend"),
      url: `http://127.0.0.1:${backendPort}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      cwd: frontendDirectory,
      url: `http://127.0.0.1:${frontendPort}`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
      },
    },
  ],
});
