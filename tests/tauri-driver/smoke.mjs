import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { remote } from "webdriverio";

const DRIVER_PORT = Number(process.env.TAURI_DRIVER_PORT || 4444);
const DRIVER_BIN = process.env.TAURI_DRIVER_BIN || "tauri-driver";
const APP_PATH = process.env.TAURI_APP_PATH || path.resolve("src-tauri/target/debug/tauri-app");

function assertAppBinaryExists(appPath) {
  if (!fs.existsSync(appPath)) {
    throw new Error(
      `Tauri app binary not found at ${appPath}. Run 'pnpm run test:tauri:prepare' first or set TAURI_APP_PATH.`,
    );
  }
}

async function startDriver() {
  const args = ["--port", String(DRIVER_PORT)];
  const child = spawn(DRIVER_BIN, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timeoutMs = 10_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      const output = `${stdout}\n${stderr}`.trim();
      const unsupported = output.toLowerCase().includes("not supported on this platform");
      if (unsupported) {
        throw new Error(
          `tauri-driver is not supported on this platform. Output:\n${output}`,
        );
      }

      throw new Error(
        `tauri-driver exited early with code ${child.exitCode}. Output:\n${output || "<empty>"}`,
      );
    }

    try {
      const session = await remote({
        logLevel: "error",
        hostname: "127.0.0.1",
        port: DRIVER_PORT,
        path: "/",
        capabilities: {
          browserName: "wry",
          "tauri:options": {
            application: APP_PATH,
          },
        },
        connectionRetryCount: 0,
      });

      await session.deleteSession();
      return child;
    } catch {
      await delay(200);
    }
  }

  child.kill("SIGTERM");
  throw new Error(
    `Timed out waiting for tauri-driver on port ${DRIVER_PORT}. Output:\n${`${stdout}\n${stderr}`.trim() || "<empty>"}`,
  );
}

async function run() {
  assertAppBinaryExists(APP_PATH);

  let driver;
  let client;
  try {
    driver = await startDriver();

    client = await remote({
      logLevel: "error",
      hostname: "127.0.0.1",
      port: DRIVER_PORT,
      path: "/",
      capabilities: {
        browserName: "wry",
        "tauri:options": {
          application: APP_PATH,
        },
      },
    });

    const title = await client.getTitle();
    assert.ok(title.includes("SproutGit"), `Expected window title to include SproutGit, got: ${title}`);

    const body = await client.$("body");
    const bodyText = await body.getText();
    assert.ok(
      bodyText.includes("Phase 1: Workspace Bootstrap"),
      "Expected bootstrap section to be visible in UI",
    );

    console.log("tauri-driver smoke test passed");
  } finally {
    if (client) {
      try {
        await client.deleteSession();
      } catch {
        // Best-effort cleanup.
      }
    }

    if (driver) {
      driver.kill("SIGTERM");
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
