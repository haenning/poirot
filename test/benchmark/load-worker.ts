import "./coordinator-setup";
import { performance } from "perf_hooks";
import { handleTool } from "../../src/mcp-tools";

const settingsPath = process.env.POIROT_SETTINGS_PATH!;
const ops = Number(process.env.POIROT_OPS ?? "25");
const workerId = process.env.POIROT_WORKER_ID ?? "0";

async function run(): Promise<void> {
  const start = performance.now();
  try {
    await Promise.all(
      Array.from({ length: ops }, (_, i) =>
        handleTool(
          "create_translation_keys",
          { entries: [{ value: `worker${workerId}_op${i}` }] },
          settingsPath
        )
      )
    );
    const msg = { pid: process.pid, ms: performance.now() - start, ok: true };
    if (process.send) process.send(msg);
    else console.log(JSON.stringify(msg));
  } catch (err) {
    const msg = {
      pid: process.pid,
      ms: performance.now() - start,
      ok: false,
      error: String(err),
    };
    if (process.send) process.send(msg);
    else {
      console.error(msg);
      process.exit(1);
    }
  }
}

run();
