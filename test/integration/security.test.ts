import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { readInlangConfig, resolveLocalePath } from "../../src/inlang";
import { handleTool, resetMutexesForTests } from "../../src/mcp-tools";

describe("security regression", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it("rejects locale path traversal via resolveLocalePath", async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "poirot-sec-"));
    const inlangDir = path.join(tempDir, "project.inlang");
    await fs.promises.mkdir(inlangDir, { recursive: true });
    await fs.promises.mkdir(path.join(tempDir, "messages"), { recursive: true });
    await fs.promises.writeFile(
      path.join(inlangDir, "settings.json"),
      JSON.stringify({
        baseLocale: "en",
        locales: ["en"],
        "plugin.inlang.messageFormat": { pathPattern: "./messages/{locale}.json" },
      }),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(tempDir, "messages/en.json"),
      JSON.stringify({ hello: "Hi" }),
      "utf8"
    );

    const settingsPath = path.join(inlangDir, "settings.json");
    const config = await readInlangConfig(settingsPath);
    expect(() => resolveLocalePath(config, "../outside")).toThrow(/Invalid locale/);
  });

  it("handleTool fails for invalid path pattern in settings", async () => {
    resetMutexesForTests();
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "poirot-sec2-"));
    const inlangDir = path.join(tempDir, "project.inlang");
    await fs.promises.mkdir(inlangDir, { recursive: true });
    const settingsPath = path.join(inlangDir, "settings.json");
    await fs.promises.writeFile(
      settingsPath,
      JSON.stringify({
        baseLocale: "en",
        locales: ["en"],
        "plugin.inlang.messageFormat": { pathPattern: "../outside/{locale}.json" },
      }),
      "utf8"
    );

    await expect(
      handleTool("create_translation_keys", { entries: [{ value: "x" }] }, settingsPath)
    ).rejects.toThrow(/Invalid path pattern/);
  });
});
