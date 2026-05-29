import path from "path";
import { withProjectFileLock } from "./project-lock";

/**
 * Single entry point for all locale file mutations.
 *
 * Layer 1 — process mutex (per settingsPath): serializes concurrent tool calls
 *            in the same MCP / extension child process.
 * Layer 2 — project file lock (per projectDir): serializes writes across
 *            independent MCP processes (extension fork + Cursor agent spawn).
 *
 * Reads (sidebar decorations, readAllLocales) intentionally bypass this — they
 * may see slightly stale data; writers always go through withProjectWrite.
 */

class AsyncMutex {
  private _chain = Promise.resolve();

  acquire<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._chain.then(fn);
    this._chain = next.then(
      () => {},
      () => {}
    );
    return next;
  }
}

const processMutexes = new Map<string, AsyncMutex>();

/** Test/benchmark overrides — never set in production activation paths. */
let testOverrides: { fileLock?: boolean; processMutex?: boolean } | null = null;

export function projectDirFromSettingsPath(settingsPath: string): string {
  return path.dirname(path.dirname(path.resolve(settingsPath)));
}

/** @internal Tests and benchmarks only. */
export function setWriteCoordinatorTestOverrides(
  overrides: { fileLock?: boolean; processMutex?: boolean } | null
): void {
  testOverrides = overrides;
}

/** @internal Tests and benchmarks only. */
export function resetWriteCoordinatorForTests(): void {
  processMutexes.clear();
  testOverrides = null;
}

function getProcessMutex(settingsPath: string): AsyncMutex {
  const key = path.resolve(settingsPath);
  let mutex = processMutexes.get(key);
  if (!mutex) {
    mutex = new AsyncMutex();
    processMutexes.set(key, mutex);
  }
  return mutex;
}

function useProcessMutex(): boolean {
  return testOverrides?.processMutex !== false;
}

function useFileLock(): boolean {
  return testOverrides?.fileLock !== false;
}

async function withProcessMutex<T>(settingsPath: string, fn: () => Promise<T>): Promise<T> {
  if (!useProcessMutex()) {
    return fn();
  }
  return getProcessMutex(settingsPath).acquire(fn);
}

async function withCrossProcessFileLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  if (!useFileLock()) {
    return fn();
  }
  return withProjectFileLock(projectDir, fn);
}

export async function withProjectWrite<T>(
  settingsPath: string,
  fn: () => Promise<T>
): Promise<T> {
  const projectDir = projectDirFromSettingsPath(settingsPath);
  return withProcessMutex(settingsPath, () => withCrossProcessFileLock(projectDir, fn));
}
