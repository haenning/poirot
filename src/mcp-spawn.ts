import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

let mcpProcess: ReturnType<typeof spawn> | null = null;

export function spawnMcpServer(scriptPath: string): void {
  if (mcpProcess) return;
  mcpProcess = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "inherit"],
    detached: false,
  });
  mcpProcess.on("error", (e) => console.error("[paraglide-helper] MCP server error:", e));
  mcpProcess.on("exit", (code) => {
    console.log("[paraglide-helper] MCP server exited with code", code);
    mcpProcess = null;
  });
}

export function writeCursorConfig(scriptPath: string): void {
  const cursorConfigPath = path.join(os.homedir(), ".cursor", "mcp.json");
  if (fs.existsSync(cursorConfigPath)) return;

  const config = {
    mcpServers: {
      "paraglide-helper": {
        command: process.execPath,
        args: [scriptPath],
      },
    },
  };

  try {
    fs.mkdirSync(path.dirname(cursorConfigPath), { recursive: true });
    fs.writeFileSync(cursorConfigPath, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.warn("[paraglide-helper] Could not write Cursor MCP config:", err);
  }
}
