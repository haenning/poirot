import fs from "fs";
import path from "path";
import lockfile from "proper-lockfile";

/** Runtime metadata directory — lock file only, never user content. */
export const POIROT_RUNTIME_DIR = ".poirot";
export const POIROT_WRITE_LOCK_FILE = "write.lock";

const LOCK_ACQUIRE_MS = 30_000;
const LOCK_STALE_MS = 30_000;

export function lockPathForProject(projectDir: string): string {
  return path.join(projectDir, POIROT_RUNTIME_DIR, POIROT_WRITE_LOCK_FILE);
}

/**
 * Cross-process exclusive lock for locale writes.
 * Uses proper-lockfile (Windows + Unix). Released automatically if the process exits.
 */
export async function withProjectFileLock<T>(
  projectDir: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockTarget = lockPathForProject(projectDir);
  await fs.promises.mkdir(path.dirname(lockTarget), { recursive: true });
  await fs.promises.writeFile(lockTarget, "", { flag: "a" });

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(lockTarget, {
      stale: LOCK_STALE_MS,
      retries: {
        retries: 120,
        minTimeout: 25,
        maxTimeout: 250,
      },
    });
  } catch (err) {
    throw new Error(
      `Could not acquire project write lock within ${LOCK_ACQUIRE_MS}ms: ${(err as Error).message}`
    );
  }

  try {
    return await fn();
  } finally {
    await release();
  }
}
