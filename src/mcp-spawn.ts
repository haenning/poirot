import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

let mcpProcess: ReturnType<typeof spawn> | null = null;

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
      } else if (line.trim()) {
        console.log("[poirot mcp]", line);
      }
    }
  });

  mcpProcess.on("error", (e) => console.error("[poirot] MCP server error:", e));
  mcpProcess.on("exit", (code) => {
    console.log("[poirot] MCP server exited with code", code);
    mcpProcess = null;
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
