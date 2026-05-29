import { describe, it, expect, afterEach } from "vitest";
import { fork, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { copyFixtureToTemp, settingsPathIn, waitForStderrLine } from "../helpers";

function ipcCall(
  child: ChildProcess,
  tool: string,
  args: unknown,
  settingsPath: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => reject(new Error("IPC timeout")), 15000);
    const onMessage = (raw: unknown) => {
      if (typeof raw !== "object" || raw === null) return;
      const msg = raw as { id: string; result?: unknown; error?: string };
      if (msg.id !== id) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result as { content: Array<{ type: string; text: string }> });
    };
    child.on("message", onMessage);
    child.send({ id, tool, args, settingsPath });
  });
}

describe("MCP IPC integration", () => {
  let child: ChildProcess | null = null;
  let projectRoot = "";
  let settingsPath = "";

  afterEach(async () => {
    child?.kill();
    child = null;
    if (projectRoot) await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("forked MCP child handles create_translation_keys over IPC", async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    settingsPath = settingsPathIn(projectRoot);
    const script = path.join(__dirname, "../../dist/mcp-server.js");
    child = fork(script, [settingsPath], { stdio: ["pipe", "pipe", "pipe", "ipc"] });

    await waitForStderrLine(child.stderr!, (line) => line.trim() === "POIROT_IPC_READY");

    const result = await ipcCall(
      child,
      "create_translation_keys",
      { entries: [{ value: "IPC test" }] },
      settingsPath
    );
    expect(result.content[0].text).toMatch(/^m\.[a-z0-9_]+\(\)/);

    const en = JSON.parse(
      await fs.promises.readFile(path.join(projectRoot, "messages/en.json"), "utf8")
    );
    expect(Object.values(en)).toContain("IPC test");
  });

  it("emits POIROT_RELOAD after writes", async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    settingsPath = settingsPathIn(projectRoot);
    const script = path.join(__dirname, "../../dist/mcp-server.js");
    child = fork(script, [settingsPath], { stdio: ["pipe", "pipe", "pipe", "ipc"] });

    await waitForStderrLine(child.stderr!, (line) => line.trim() === "POIROT_IPC_READY");

    const reloadPromise = waitForStderrLine(
      child.stderr!,
      (line) => line.trim() === "POIROT_RELOAD"
    );
    await ipcCall(
      child,
      "set_translation_values",
      { entries: [{ key: "hello_world", locale: "en", value: "Updated" }] },
      settingsPath
    );
    await expect(reloadPromise).resolves.toBe("POIROT_RELOAD");
  });
});
