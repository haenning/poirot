import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fork, type ChildProcess } from "child_process";
import { copyFixtureToTemp, settingsPathIn } from "../helpers";

const PROCESS_COUNT = 8;
const OPS_PER_PROCESS = 25;

function readLocaleKeySets(projectRoot: string): { enKeys: string[]; deKeys: string[] } {
  const en = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "messages/en.json"), "utf8")
  ) as Record<string, string>;
  const de = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "messages/de.json"), "utf8")
  ) as Record<string, string>;
  return {
    enKeys: Object.keys(en).filter((k) => k !== "$schema").sort(),
    deKeys: Object.keys(de).filter((k) => k !== "$schema").sort(),
  };
}

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

  // Mutex-only data loss is non-deterministic — see npm run test:bench for a manual comparison.
  it("with file lock: all keys preserved across locales", async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    const settingsPath = settingsPathIn(projectRoot);
    const workers = await forkWorkers(settingsPath, true);
    expect(workers.every((w) => w.ok)).toBe(true);

    const expected = 1 + PROCESS_COUNT * OPS_PER_PROCESS;
    const { enKeys, deKeys } = readLocaleKeySets(projectRoot);
    expect(enKeys.length).toBe(expected);
    expect(deKeys.length).toBe(expected);
    expect(enKeys).toEqual(deKeys);
  }, 120000);
});
