import fs from "fs";
import path from "path";
import { fork, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { copyFixtureToTemp, settingsPathIn } from "../helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROCESS_COUNT = 8;
const OPS_PER_PROCESS = 25;
const TOTAL_OPS = PROCESS_COUNT * OPS_PER_PROCESS;

interface WorkerResult {
  pid: number;
  ms: number;
  ok: boolean;
  error?: string;
}

function validateLocaleJson(projectRoot: string): { valid: boolean; keys: number } {
  const enPath = path.join(projectRoot, "messages/en.json");
  const dePath = path.join(projectRoot, "messages/de.json");
  try {
    const en = JSON.parse(fs.readFileSync(enPath, "utf8")) as Record<string, string>;
    const de = JSON.parse(fs.readFileSync(dePath, "utf8")) as Record<string, string>;
    const enKeys = Object.keys(en).filter((k) => k !== "$schema");
    const deKeys = Object.keys(de).filter((k) => k !== "$schema");
    return { valid: enKeys.length === deKeys.length, keys: enKeys.length };
  } catch {
    return { valid: false, keys: 0 };
  }
}

async function runMultiProcessLoad(
  projectRoot: string,
  settingsPath: string,
  useProjectLock: boolean
): Promise<{ wallMs: number; workers: WorkerResult[]; integrity: ReturnType<typeof validateLocaleJson> }> {
  const workerScript = path.join(__dirname, "load-worker.ts");
  const wallStart = performance.now();
  const children: ChildProcess[] = [];

  const results = await new Promise<WorkerResult[]>((resolve, reject) => {
    const collected: WorkerResult[] = [];
    let pending = PROCESS_COUNT;

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
        if (pending === 0) resolve(collected);
      });

      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0 && pending > 0) {
          reject(new Error(`Worker ${child.pid} exited with code ${code}`));
        }
      });
    }
  });

  for (const child of children) {
    child.kill();
  }

  const wallMs = performance.now() - wallStart;
  const integrity = validateLocaleJson(projectRoot);
  return { wallMs, workers: results, integrity };
}

async function main(): Promise<void> {
  console.log("Poirot cross-process write load benchmark");
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Load: ${PROCESS_COUNT} processes × ${OPS_PER_PROCESS} ops = ${TOTAL_OPS} create_translation_keys`);
  console.log("");

  const projectRoot = await copyFixtureToTemp("minimal-inlang");
  const settingsPath = settingsPathIn(projectRoot);

  try {
    console.log("── Run 1: process mutex only (file lock disabled via test override) ──");
    const withoutLock = await runMultiProcessLoad(projectRoot, settingsPath, false);
    console.log(`  Wall time:     ${withoutLock.wallMs.toFixed(1)} ms`);
    console.log(
      `  Worker times:  min=${Math.min(...withoutLock.workers.map((w) => w.ms)).toFixed(1)} ms  max=${Math.max(...withoutLock.workers.map((w) => w.ms)).toFixed(1)} ms  avg=${(withoutLock.workers.reduce((s, w) => s + w.ms, 0) / withoutLock.workers.length).toFixed(1)} ms`
    );
    console.log(
      `  Integrity:     JSON valid=${withoutLock.integrity.valid}  en keys=${withoutLock.integrity.keys}  expected≈${1 + TOTAL_OPS} (hello_world + new keys)`
    );
    console.log(`  Workers OK:    ${withoutLock.workers.filter((w) => w.ok).length}/${PROCESS_COUNT}`);

    // Reset fixture for fair comparison
    await fs.promises.rm(projectRoot, { recursive: true, force: true });
    const projectRoot2 = await copyFixtureToTemp("minimal-inlang");
    const settingsPath2 = settingsPathIn(projectRoot2);

    console.log("");
    console.log("── Run 2: write coordinator (process mutex + cross-process file lock) ──");
    const withLock = await runMultiProcessLoad(projectRoot2, settingsPath2, true);
    console.log(`  Wall time:     ${withLock.wallMs.toFixed(1)} ms`);
    console.log(
      `  Worker times:  min=${Math.min(...withLock.workers.map((w) => w.ms)).toFixed(1)} ms  max=${Math.max(...withLock.workers.map((w) => w.ms)).toFixed(1)} ms  avg=${(withLock.workers.reduce((s, w) => s + w.ms, 0) / withLock.workers.length).toFixed(1)} ms`
    );
    console.log(
      `  Integrity:     JSON valid=${withLock.integrity.valid}  en keys=${withLock.integrity.keys}  expected≈${1 + TOTAL_OPS}`
    );
    console.log(`  Workers OK:    ${withLock.workers.filter((w) => w.ok).length}/${PROCESS_COUNT}`);

    const overhead = withLock.wallMs - withoutLock.wallMs;
    const overheadPct = (overhead / withoutLock.wallMs) * 100;
    console.log("");
    console.log("── Summary ──");
    console.log(`  Without file lock: ${withoutLock.wallMs.toFixed(1)} ms`);
    console.log(`  With file lock:    ${withLock.wallMs.toFixed(1)} ms`);
    console.log(`  Overhead:          ${overhead >= 0 ? "+" : ""}${overhead.toFixed(1)} ms (${overheadPct >= 0 ? "+" : ""}${overheadPct.toFixed(1)}%)`);
    console.log(
      `  Cross-locale sync: without=${withoutLock.integrity.valid ? "yes" : "NO — key count mismatch"}  with=${withLock.integrity.valid ? "yes" : "NO"}`
    );

    await fs.promises.rm(projectRoot2, { recursive: true, force: true });
  } finally {
    try {
      await fs.promises.rm(projectRoot, { recursive: true, force: true });
    } catch {
      /* already removed */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
