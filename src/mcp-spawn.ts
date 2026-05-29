import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

let mcpProcess: ReturnType<typeof spawn> | null = null;
let _socketPath: string | null = null;
let _pendingCalls = new Map<string, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
let _conn: net.Socket | null = null;
let _connBuf = "";
let _connQueue: Array<string> = []; // messages buffered before socket is ready

function socketPathForSettings(settingsPath: string): string {
  const hash = crypto.createHash("sha1").update(settingsPath).digest("hex").slice(0, 12);
  if (process.platform === "win32") return `\\\\.\\pipe\\poirot-${hash}`;
  return path.join(os.tmpdir(), `poirot-${hash}.sock`);
}

function connectSocket(sockPath: string): void {
  _socketPath = sockPath;
  const conn = net.createConnection(sockPath);
  _conn = conn;

  conn.on("connect", () => {
    // Flush any messages that arrived before the socket was ready
    for (const msg of _connQueue) conn.write(msg);
    _connQueue = [];
  });

  conn.on("data", (chunk) => {
    _connBuf += chunk.toString();
    const lines = _connBuf.split("\n");
    _connBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: { id: string; result?: unknown; error?: string };
      try { msg = JSON.parse(line); } catch { continue; }
      const pending = _pendingCalls.get(msg.id);
      if (!pending) continue;
      _pendingCalls.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    }
  });

  conn.on("error", (e) => console.error("[poirot] socket error:", e));
  conn.on("close", () => { _conn = null; });
}

export function callMcpTool(tool: string, args: unknown, settingsPath: string): Promise<{ content: Array<{ type: string; text: string }> }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    _pendingCalls.set(id, {
      resolve: resolve as (r: unknown) => void,
      reject,
    });
    const msg = JSON.stringify({ id, tool, args, settingsPath }) + "\n";
    if (_conn && !_conn.destroyed) {
      _conn.write(msg);
    } else {
      _connQueue.push(msg);
    }
    // Timeout after 30s to avoid hanging forever
    setTimeout(() => {
      if (_pendingCalls.has(id)) {
        _pendingCalls.delete(id);
        reject(new Error(`callMcpTool("${tool}") timed out`));
      }
    }, 30000);
  });
}

export function spawnMcpServer(scriptPath: string, settingsPath: string | undefined, onReload: () => void): void {
  if (mcpProcess) return;
  const args = settingsPath ? [scriptPath, settingsPath] : [scriptPath];
  mcpProcess = spawn(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  let stderrBuf = "";
  mcpProcess.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "POIROT_RELOAD") {
        onReload();
      } else if (line.startsWith("POIROT_SOCKET:")) {
        const sockPath = line.slice("POIROT_SOCKET:".length).trim();
        connectSocket(sockPath);
      } else if (line.trim()) {
        console.log("[poirot mcp]", line);
      }
    }
  });

  mcpProcess.on("error", (e) => console.error("[poirot] MCP server error:", e));
  mcpProcess.on("exit", (code) => {
    console.log("[poirot] MCP server exited with code", code);
    mcpProcess = null;
    _conn = null;
  });
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
