import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { handleTool, MCP_TOOL_DEFINITIONS } from "./mcp-tools";
import { assertIpcMessageSize, type IpcToolRequest } from "./mcp-ipc";

const EXTENSION_VERSION = "0.2.0";

function getSettingsPath(): string {
  return process.argv[2] ?? path.join(process.cwd(), "project.inlang", "settings.json");
}

function startIpcHandler(defaultSettingsPath: string): void {
  if (!process.send) return;

  process.on("message", (raw: unknown) => {
    if (typeof raw !== "object" || raw === null) return;
    const req = raw as IpcToolRequest;
    if (!req.id || !req.tool) return;

    try {
      assertIpcMessageSize(raw);
    } catch (err) {
      process.send!({ id: req.id, error: String(err) });
      return;
    }

    const settingsPath = req.settingsPath ?? defaultSettingsPath;
    handleTool(req.tool, req.args, settingsPath)
      .then((result) => process.send!({ id: req.id, result }))
      .catch((err) => process.send!({ id: req.id, error: String(err) }));
  });

  process.stderr.write("POIROT_IPC_READY\n");
}

async function runMcpServer(): Promise<void> {
  const settingsPath = getSettingsPath();
  startIpcHandler(settingsPath);

  const server = new Server(
    { name: "poirot", version: EXTENSION_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...MCP_TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleTool(name, args, settingsPath);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
