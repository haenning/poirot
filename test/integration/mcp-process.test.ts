import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import { copyFixtureToTemp, settingsPathIn } from "../helpers";
import { handleTool, resetMutexesForTests } from "../../src/mcp-tools";

describe("concurrency integration", () => {
  let projectRoot = "";
  let settingsPath = "";

  afterEach(async () => {
    if (projectRoot) await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("handles parallel set_translation_values without corrupt JSON", async () => {
    resetMutexesForTests();
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    settingsPath = settingsPathIn(projectRoot);

    await handleTool("create_translation_keys", { entries: [{ value: "Base" }] }, settingsPath);
    const config = await import("../../src/inlang").then((m) => m.readInlangConfig(settingsPath));
    const localeMap = await import("../../src/inlang").then((m) => m.readAllLocales(config));
    const keys = (await import("../../src/inlang")).getAllKeys(localeMap, config.baseLocale);
    const key = keys.find((k) => k !== "hello_world");
    expect(key).toBeTruthy();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        handleTool(
          "set_translation_values",
          { entries: [{ key: key!, locale: "de", value: `Value ${i}` }] },
          settingsPath
        )
      )
    );
    expect(results.every((r) => r.content[0].text.includes("✓"))).toBe(true);

    const deRaw = await fs.promises.readFile(path.join(projectRoot, "messages/de.json"), "utf8");
    expect(() => JSON.parse(deRaw)).not.toThrow();
  });
});

describe("MCP stdio smoke", () => {
  let proc: ChildProcessWithoutNullStreams | null = null;
  let projectRoot = "";

  afterEach(async () => {
    proc?.kill();
    proc = null;
    if (projectRoot) await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("MCP server process starts and accepts initialize", async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    const settingsPath = settingsPathIn(projectRoot);
    const script = path.join(__dirname, "../../dist/mcp-server.js");

    proc = spawn(process.execPath, [script, settingsPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "poirot-test", version: "1.0.0" },
      },
    };

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stdin.write(JSON.stringify(init) + "\n");

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("stdio timeout")), 10000);
      const check = setInterval(() => {
        if (stdout.includes('"result"') || stdout.includes("protocolVersion")) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 50);
    });

    expect(stdout).toContain("poirot");
  });
});
