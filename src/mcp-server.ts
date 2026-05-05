import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readInlangConfig, readAllLocales, getAllKeys, addKey } from "./inlang";
import { generateUniqueKey } from "./keygen";

async function runMcpServer(): Promise<void> {
  const server = new Server(
    { name: "paraglide-helper", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_translation_key",
        description: "Create a new i18n translation key with a human-readable name",
        inputSchema: {
          type: "object" as const,
          properties: {
            value: { type: "string", description: "Base locale translation value" },
          },
          required: ["value"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "create_translation_key") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const value = (request.params.arguments as { value: string }).value;
    const settingsPath = path.join(process.cwd(), "project.inlang", "settings.json");

    const config = await readInlangConfig(settingsPath);
    const localeMap = await readAllLocales(config);
    const existing = new Set(getAllKeys(localeMap, config.baseLocale));
    const key = generateUniqueKey(existing);

    await addKey(config, localeMap, key, value);

    return {
      content: [{ type: "text" as const, text: `m.${key}()` }],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
