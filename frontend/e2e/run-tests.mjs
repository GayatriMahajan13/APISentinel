import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = resolve(frontendDirectory, "..");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "apisentinel-playwright-"));
const databasePath = join(temporaryDirectory, "browser-tests.sqlite3");
const playwrightCli = join(frontendDirectory, "node_modules", "@playwright", "test", "cli.js");
const openmpDirectory = join(projectRoot, "vendor", "libomp");
const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    cwd: frontendDirectory,
    env: {
      ...process.env,
      APISENTINEL_PLAYWRIGHT_TEMP_DIR: temporaryDirectory,
      DATABASE_URL: `sqlite:///${databasePath}`,
      DYLD_LIBRARY_PATH: `${openmpDirectory}:${process.env.DYLD_LIBRARY_PATH ?? ""}`,
    },
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => child.kill(signal);
process.on("SIGINT", forwardSignal);
process.on("SIGTERM", forwardSignal);

let exitCode = 1;
try {
  exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  process.off("SIGINT", forwardSignal);
  process.off("SIGTERM", forwardSignal);

  const resolvedDirectory = resolve(temporaryDirectory);
  if (
    dirname(resolvedDirectory) !== resolve(tmpdir()) ||
    !basename(resolvedDirectory).startsWith("apisentinel-playwright-")
  ) {
    throw new Error("Refusing to remove a directory outside the Playwright temporary database location.");
  }

  for (const path of [databasePath, `${databasePath}-shm`, `${databasePath}-wal`]) {
    rmSync(path, { force: true });
  }
  rmdirSync(resolvedDirectory);
}

process.exitCode = exitCode;
