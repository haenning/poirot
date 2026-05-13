import path from "path";
import { execSync } from "child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readInlangConfig, readAllLocales, getAllKeys, addKey } from "./inlang";
import { generateUniqueKey } from "./keygen";

function getSettingsPath(): string {
  return process.argv[2] ?? path.join(process.cwd(), "project.inlang", "settings.json");
}

async function runMcpServer(): Promise<void> {
  const server = new Server(
    { name: "poirot", version: "0.0.2" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_translation_key",
        description:
          "Create a single new i18n translation key. " +
          "IMPORTANT: If you need to create more than one key, use create_translation_keys (bulk) instead — " +
          "never call this tool in a loop.",
        inputSchema: {
          type: "object" as const,
          properties: {
            value: { type: "string", description: "Base locale translation value (human-readable text)" },
          },
          required: ["value"],
        },
      },
      {
        name: "create_translation_keys",
        description:
          "Create multiple i18n translation keys in one call. " +
          "Always use this instead of calling create_translation_key multiple times. " +
          "Returns an array of generated key references in the same order as the input.",
        inputSchema: {
          type: "object" as const,
          properties: {
            entries: {
              type: "array",
              description: "List of keys to create",
              items: {
                type: "object",
                properties: {
                  value: { type: "string", description: "Base locale translation value" },
                },
                required: ["value"],
              },
              minItems: 1,
            },
          },
          required: ["entries"],
        },
      },
      {
        name: "auto_translate",
        description:
          "Translate all missing locale values using Claude AI. " +
          "IMPORTANT: Only call this tool once, at the very end of your entire editing session, " +
          "after all translation keys have been created. Never call it speculatively or mid-session. " +
          "Requires ANTHROPIC_API_KEY environment variable.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
      {
        name: "check_paraglide",
        description:
          "Compile the paraglide-js project and report any missing translation keys across locales. " +
          "Use this after significant batches of changes (multiple keys added or values edited) " +
          "to verify consistency. Do not call after every single key creation.",
        inputSchema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── single key ──────────────────────────────────────────────────────────
    if (name === "create_translation_key") {
      const { value } = args as { value: string };
      const settingsPath = getSettingsPath();
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const existing = new Set(getAllKeys(localeMap, config.baseLocale));
      const key = generateUniqueKey(existing);
      await addKey(config, localeMap, key, value);
      process.stderr.write("POIROT_RELOAD\n");
      return { content: [{ type: "text" as const, text: `m.${key}()` }] };
    }

    // ── bulk keys ────────────────────────────────────────────────────────────
    if (name === "create_translation_keys") {
      const { entries } = args as { entries: Array<{ value: string }> };
      const settingsPath = getSettingsPath();
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const existing = new Set(getAllKeys(localeMap, config.baseLocale));

      const results: string[] = [];
      for (const entry of entries) {
        const key = generateUniqueKey(existing);
        existing.add(key);
        await addKey(config, localeMap, key, entry.value);
        results.push(`m.${key}()`);
      }

      process.stderr.write("POIROT_RELOAD\n");

      const lines = entries.map((e, i) => `${results[i]}  ← "${e.value}"`).join("\n");
      return { content: [{ type: "text" as const, text: lines }] };
    }

    // ── auto translate ───────────────────────────────────────────────────────
    if (name === "auto_translate") {
      const settingsPath = getSettingsPath();
      const config = await readInlangConfig(settingsPath);
      try {
        const output = execSync("npm run machine-translate", {
          cwd: config.projectDir,
          timeout: 60000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        process.stderr.write("POIROT_RELOAD\n");
        return { content: [{ type: "text" as const, text: output.trim() || "machine-translate completed." }] };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const detail = (e.stderr ?? e.stdout ?? e.message ?? String(err)).trim();
        return { content: [{ type: "text" as const, text: `machine-translate failed:\n${detail}` }] };
      }
    }

    // ── check paraglide ──────────────────────────────────────────────────────
    if (name === "check_paraglide") {
      const settingsPath = getSettingsPath();
      const config = await readInlangConfig(settingsPath);

      // 1. Check for missing keys across locales
      const localeMap = await readAllLocales(config);
      const baseKeys = getAllKeys(localeMap, config.baseLocale);
      const issues: string[] = [];

      for (const locale of config.locales) {
        if (locale === config.baseLocale) continue;
        const messages = localeMap[locale] ?? {};
        const missing = baseKeys.filter((k) => !messages[k]);
        if (missing.length > 0) {
          issues.push(`${locale}: missing ${missing.length} key(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` … +${missing.length - 5} more` : ""}`);
        }
        // Keys in secondary locale not in base (orphans)
        const orphans = Object.keys(messages).filter((k) => k !== "$schema" && !baseKeys.includes(k));
        if (orphans.length > 0) {
          issues.push(`${locale}: ${orphans.length} orphan key(s) not in base: ${orphans.slice(0, 3).join(", ")}`);
        }
      }

      // 2. Try to run paraglide compile
      let compileOutput = "";
      try {
        const cwd = config.projectDir;
        const result = execSync(
          "npx --yes @inlang/paraglide-js compile --project project.inlang",
          { cwd, timeout: 30000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
        );
        compileOutput = `Paraglide compile: OK\n${result ?? ""}`.trim();
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        compileOutput = `Paraglide compile failed:\n${e.stderr ?? e.stdout ?? e.message ?? String(err)}`.trim();
      }

      const keyReport = issues.length === 0
        ? `All ${baseKeys.length} base keys are present in every locale.`
        : `Key issues found:\n${issues.join("\n")}`;

      return {
        content: [{
          type: "text" as const,
          text: `${keyReport}\n\n${compileOutput}`,
        }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
