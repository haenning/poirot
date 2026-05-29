import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { atomicWriteJson } from "./atomic";

describe("atomicWriteJson", () => {
  const files: string[] = [];

  afterEach(async () => {
    for (const f of files) {
      await fs.promises.rm(f, { force: true }).catch(() => {});
    }
    files.length = 0;
  });

  it("writes valid JSON that can be read back", async () => {
    const filePath = path.join(os.tmpdir(), `poirot-atomic-${Date.now()}.json`);
    files.push(filePath);
    await atomicWriteJson(filePath, { hello: "world" });
    const raw = await fs.promises.readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual({ hello: "world" });
  });
});
