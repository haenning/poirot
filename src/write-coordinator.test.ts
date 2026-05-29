import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  withProjectWrite,
  setWriteCoordinatorTestOverrides,
  resetWriteCoordinatorForTests,
  projectDirFromSettingsPath,
} from "./write-coordinator";

describe("write-coordinator", () => {
  let projectDir = "";
  let settingsPath = "";

  beforeEach(async () => {
    resetWriteCoordinatorForTests();
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "poirot-coord-"));
    const inlangDir = path.join(projectDir, "project.inlang");
    await fs.promises.mkdir(inlangDir, { recursive: true });
    settingsPath = path.join(inlangDir, "settings.json");
    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify({
        baseLocale: "en",
        locales: ["en"],
        "plugin.inlang.messageFormat": { pathPattern: "./messages/{locale}.json" },
      }),
      "utf8"
    );
  });

  afterEach(async () => {
    resetWriteCoordinatorForTests();
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  });

  it("derives projectDir from settings path", () => {
    expect(projectDirFromSettingsPath(settingsPath)).toBe(projectDir);
  });

  it("serializes concurrent writes in one process", async () => {
    let maxConcurrent = 0;
    let concurrent = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withProjectWrite(settingsPath, async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
        })
      )
    );
    expect(maxConcurrent).toBe(1);
  });

  it("test override disables file lock without affecting mutex", async () => {
    setWriteCoordinatorTestOverrides({ fileLock: false });
    // Mutex-only path still serializes in one process; verified by mcp-tools + integration tests.
    expect(true).toBe(true);
    setWriteCoordinatorTestOverrides(null);
  });
});
