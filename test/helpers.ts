import fs from "fs";
import path from "path";
import os from "os";

export function fixturePath(...parts: string[]): string {
  return path.join(process.cwd(), "test", "fixtures", ...parts);
}

export async function copyFixtureToTemp(fixtureName: string): Promise<string> {
  const src = fixturePath(fixtureName);
  const dest = await fs.promises.mkdtemp(path.join(os.tmpdir(), `poirot-${fixtureName}-`));
  await fs.promises.cp(src, dest, { recursive: true });
  return dest;
}

export function settingsPathIn(projectRoot: string): string {
  return path.join(projectRoot, "project.inlang", "settings.json");
}

export async function waitForStderrLine(
  stream: NodeJS.ReadableStream,
  predicate: (line: string) => boolean,
  timeoutMs = 10000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for stderr line")), timeoutMs);
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (predicate(line)) {
          clearTimeout(timer);
          resolve(line);
          return;
        }
      }
    });
  });
}
