import { fork, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { assertIpcMessageSize, type IpcToolRequest, type IpcToolResponse } from "./mcp-ipc";

let mcpProcess: ChildProcess | null = null;
let ipcReady = false;
let ipcQueue: IpcToolRequest[] = [];
const pendingCalls = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();

function flushIpcQueue(): void {
  if (!mcpProcess?.connected) return;
  for (const msg of ipcQueue) {
    mcpProcess.send!(msg);
  }
  ipcQueue = [];
}

function handleIpcResponse(msg: IpcToolResponse): void {
  const pending = pendingCalls.get(msg.id);
  if (!pending) return;
  pendingCalls.delete(msg.id);
  if (msg.error) pending.reject(new Error(msg.error));
  else pending.resolve(msg.result);
}

export function callMcpTool(
  tool: string,
  args: unknown,
  settingsPath: string
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return new Promise((resolve, reject) => {
    if (!mcpProcess) {
      reject(new Error("MCP server is not running"));
      return;
    }

    const id = crypto.randomUUID();
    const payload: IpcToolRequest = { id, tool, args, settingsPath };

    try {
      assertIpcMessageSize(payload);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    pendingCalls.set(id, {
      resolve: resolve as (r: unknown) => void,
      reject,
    });

    if (ipcReady && mcpProcess.connected) {
      mcpProcess.send(payload);
    } else {
      ipcQueue.push(payload);
    }

    setTimeout(() => {
      if (pendingCalls.has(id)) {
        pendingCalls.delete(id);
        reject(new Error(`callMcpTool("${tool}") timed out`));
      }
    }, 30000);
  });
}

export function spawnMcpServer(
  scriptPath: string,
  settingsPath: string | undefined,
  onReload: () => void
): void {
  if (mcpProcess) return;

  const args = settingsPath ? [settingsPath] : [];
  mcpProcess = fork(scriptPath, args, {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    detached: false,
  });

  ipcReady = false;
  ipcQueue = [];

  let stderrBuf = "";
  mcpProcess.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "POIROT_RELOAD") {
        onReload();
      } else if (line.trim() === "POIROT_IPC_READY") {
        ipcReady = true;
        flushIpcQueue();
      } else if (line.trim()) {
        console.log("[poirot mcp]", line);
      }
    }
  });

  mcpProcess.on("message", (raw: unknown) => {
    if (typeof raw !== "object" || raw === null) return;
    handleIpcResponse(raw as IpcToolResponse);
  });

  mcpProcess.on("error", (e) => console.error("[poirot] MCP server error:", e));
  mcpProcess.on("exit", (code) => {
    console.log("[poirot] MCP server exited with code", code);
    mcpProcess = null;
    ipcReady = false;
    for (const [, pending] of pendingCalls) {
      pending.reject(new Error("MCP server exited"));
    }
    pendingCalls.clear();
    ipcQueue = [];
  });
}

export function stopMcpServer(): void {
  if (!mcpProcess) return;
  mcpProcess.removeAllListeners();
  mcpProcess.kill();
  mcpProcess = null;
  ipcReady = false;
  for (const [, pending] of pendingCalls) {
    pending.reject(new Error("MCP server stopped"));
  }
  pendingCalls.clear();
  ipcQueue = [];
}

export function restartMcpServer(
  scriptPath: string,
  settingsPath: string | undefined,
  onReload: () => void
): void {
  stopMcpServer();
  spawnMcpServer(scriptPath, settingsPath, onReload);
}

export function writeCursorConfig(scriptPath: string, settingsPath?: string): void {
  const cursorConfigPath = path.join(os.homedir(), ".cursor", "mcp.json");

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(cursorConfigPath, "utf8"));
  } catch {
    // file doesn't exist or is invalid — start fresh
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  const args = settingsPath ? [scriptPath, settingsPath] : [scriptPath];
  servers["poirot"] = { command: process.execPath, args };
  existing.mcpServers = servers;

  try {
    fs.mkdirSync(path.dirname(cursorConfigPath), { recursive: true });
    fs.writeFileSync(cursorConfigPath, JSON.stringify(existing, null, 2), "utf8");
    console.log("[poirot] wrote Cursor MCP config:", cursorConfigPath);
  } catch (err) {
    console.warn("[poirot] Could not write Cursor MCP config:", err);
  }
}
