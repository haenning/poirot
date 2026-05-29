import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { withProjectFileLock, lockPathForProject, POIROT_RUNTIME_DIR } from "./project-lock";

describe("project-lock", () => {
  let projectDir = "";

  beforeEach(async () => {
    projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "poirot-lock-"));
  });

  afterEach(async () => {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  });

  it("serializes concurrent file lock holders", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        withProjectFileLock(projectDir, async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 15));
          concurrent--;
        })
      )
    );
    expect(maxConcurrent).toBe(1);
  });

  it(`creates lock at ${POIROT_RUNTIME_DIR}/write.lock`, async () => {
    await withProjectFileLock(projectDir, async () => {
      expect(fs.existsSync(lockPathForProject(projectDir))).toBe(true);
    });
  });
});
