import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fork, type ChildProcess } from "child_process";
import { copyFixtureToTemp, settingsPathIn } from "../helpers";

const PROCESS_COUNT = 4;
const OPS_PER_PROCESS = 15;

interface WorkerResult {
  pid: number;
  ms: number;
  ok: boolean;
  error?: string;
}

function forkWorkers(
  settingsPath: string,
  useProjectLock: boolean
): Promise<WorkerResult[]> {
  const workerScript = path.join(__dirname, "../benchmark/load-worker.ts");
  return new Promise((resolve, reject) => {
    const collected: WorkerResult[] = [];
    let pending = PROCESS_COUNT;
    const children: ChildProcess[] = [];

    for (let i = 0; i < PROCESS_COUNT; i++) {
      const child = fork(workerScript, [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          POIROT_SETTINGS_PATH: settingsPath,
          POIROT_OPS: String(OPS_PER_PROCESS),
          POIROT_WORKER_ID: String(i),
          POIROT_COORDINATOR_MODE: useProjectLock ? "full" : "mutex-only",
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      children.push(child);

      child.on("message", (msg: WorkerResult) => {
        collected.push(msg);
        pending--;
        if (pending === 0) {
          for (const c of children) c.kill();
          resolve(collected);
        }
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0 && pending > 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    }
  });
}

describe("cross-process project lock", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("without file lock: parallel MCP processes can lose keys", async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    const settingsPath = settingsPathIn(projectRoot);
    const workers = await forkWorkers(settingsPath, false);
    expect(workers.every((w) => w.ok)).toBe(true);

    const en = JSON.parse(
      await fs.promises.readFile(path.join(projectRoot, "messages/en.json"), "utf8")
    ) as Record<string, string>;
    const de = JSON.parse(
      await fs.promises.readFile(path.join(projectRoot, "messages/de.json"), "utf8")
    ) as Record<string, string>;
    const enCount = Object.keys(en).filter((k) => k !== "$schema").length;
    const deCount = Object.keys(de).filter((k) => k !== "$schema").length;
    const expected = 1 + PROCESS_COUNT * OPS_PER_PROCESS;
    // Race: counts may diverge or be short — do not assert equality
    expect(enCount).toBeLessThan(expected);
    expect(enCount).not.toBe(deCount);
  }, 60000);

  it("with file lock: all keys preserved across locales", async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    const settingsPath = settingsPathIn(projectRoot);
    const workers = await forkWorkers(settingsPath, true);
    expect(workers.every((w) => w.ok)).toBe(true);

    const en = JSON.parse(
      await fs.promises.readFile(path.join(projectRoot, "messages/en.json"), "utf8")
    ) as Record<string, string>;
    const de = JSON.parse(
      await fs.promises.readFile(path.join(projectRoot, "messages/de.json"), "utf8")
    ) as Record<string, string>;
    const enKeys = Object.keys(en).filter((k) => k !== "$schema");
    const deKeys = Object.keys(de).filter((k) => k !== "$schema");
    const expected = 1 + PROCESS_COUNT * OPS_PER_PROCESS;
    expect(enKeys.length).toBe(expected);
    expect(deKeys.length).toBe(expected);
  }, 60000);
});
