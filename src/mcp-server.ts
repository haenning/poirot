import path from "path";
import net from "net";
import { execSync } from "child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readInlangConfig, readAllLocales, getAllKeys, addKey, setLocaleValue, renameKey } from "./inlang";
import { generateUniqueKey } from "./keygen";
import os from "os";
import crypto from "crypto";

function getSettingsPath(): string {
  return process.argv[2] ?? path.join(process.cwd(), "project.inlang", "settings.json");
}

export function socketPathForSettings(settingsPath: string): string {
  const hash = crypto.createHash("sha1").update(settingsPath).digest("hex").slice(0, 12);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\poirot-${hash}`;
  }
  return path.join(os.tmpdir(), `poirot-${hash}.sock`);
}

// ── mutex ─────────────────────────────────────────────────────────────────────

class AsyncMutex {
  private _chain = Promise.resolve();
  acquire<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._chain.then(fn);
    this._chain = next.then(() => {}, () => {});
    return next;
  }
}

const _mutexes = new Map<string, AsyncMutex>();
function getMutex(settingsPath: string): AsyncMutex {
  let m = _mutexes.get(settingsPath);
  if (!m) { m = new AsyncMutex(); _mutexes.set(settingsPath, m); }
  return m;
}

// ── tool handler ──────────────────────────────────────────────────────────────
// Single implementation used by both stdio MCP and socket callers.

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

async function handleTool(name: string, args: unknown, settingsPath: string): Promise<ToolResult> {
  return getMutex(settingsPath).acquire(async () => {

    // ── create keys ────────────────────────────────────────────────────────
    if (name === "create_translation_keys") {
      const { entries } = args as { entries: Array<{ value: string }> };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const existing = new Set(getAllKeys(localeMap, config.baseLocale));
      const lines: string[] = [];

      for (const entry of entries) {
        const key = generateUniqueKey(existing);
        existing.add(key);
        await addKey(config, localeMap, key, entry.value);
        lines.push(`m.${key}()  [${config.baseLocale}] "${entry.value}"`);
      }

      process.stderr.write("POIROT_RELOAD\n");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    // ── set translation values ─────────────────────────────────────────────
    if (name === "set_translation_values") {
      const { entries } = args as { entries: Array<{ key: string; locale: string; value: string }> };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const lines: string[] = [];

      for (const { key, locale, value } of entries) {
        try {
          await setLocaleValue(config, localeMap, key, locale, value);
          lines.push(`✓ m.${key}()  [${locale}] "${value}"`);
        } catch (err: unknown) {
          lines.push(`✗ m.${key}()  [${locale}] — ${(err as Error).message}`);
        }
      }

      process.stderr.write("POIROT_RELOAD\n");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    // ── rename keys ────────────────────────────────────────────────────────
    if (name === "rename_translation_keys") {
      const { keys } = args as { keys: string[] };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const existing = new Set(getAllKeys(localeMap, config.baseLocale));
      const lines: string[] = [];

      for (const key of keys) {
        if (!existing.has(key)) {
          lines.push(`✗ m.${key}() — not found`);
          continue;
        }
        const newKey = generateUniqueKey(existing);
        existing.add(newKey);
        existing.delete(key);
        const baseValue = localeMap[config.baseLocale]?.[key] ?? "";
        await renameKey(config, localeMap, key, newKey);
        lines.push(`m.${key}() → m.${newKey}()  [${config.baseLocale}] "${baseValue}"`);
      }

      process.stderr.write("POIROT_RELOAD\n");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    // ── auto translate ─────────────────────────────────────────────────────
    if (name === "auto_translate") {
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
        return { content: [{ type: "text" as const, text: `machine-translate failed:\n${(e.stderr ?? e.stdout ?? e.message ?? String(err)).trim()}` }] };
      }
    }

    // ── check paraglide ────────────────────────────────────────────────────
    if (name === "check_paraglide") {
      const config = await readInlangConfig(settingsPath);
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
        const orphans = Object.keys(messages).filter((k) => k !== "$schema" && !baseKeys.includes(k));
        if (orphans.length > 0) {
          issues.push(`${locale}: ${orphans.length} orphan key(s): ${orphans.slice(0, 3).join(", ")}`);
        }
      }

      let compileOutput = "";
      try {
        const outdirFlag = config.paraglideOutdir ? ` --outdir ${config.paraglideOutdir}` : "";
        const result = execSync(
          `npx --yes @inlang/paraglide-js compile --project project.inlang${outdirFlag}`,
          { cwd: config.projectDir, timeout: 30000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
        );
        compileOutput = `Paraglide compile: OK\n${result ?? ""}`.trim();
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        compileOutput = `Paraglide compile failed:\n${(e.stderr ?? e.stdout ?? e.message ?? String(err)).trim()}`;
      }

      const keyReport = issues.length === 0
        ? `All ${baseKeys.length} base keys present in every locale.`
        : `Key issues:\n${issues.join("\n")}`;

      return { content: [{ type: "text" as const, text: `${keyReport}\n\n${compileOutput}` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });
}

// ── socket server ─────────────────────────────────────────────────────────────
// Accepts newline-delimited JSON: { id, tool, args, settingsPath }
// Responds with:                  { id, result } or { id, error }

function startSocketServer(sockPath: string, settingsPath: string): void {
  // Clean up stale socket file on Unix
  if (process.platform !== "win32") {
    try { require("fs").unlinkSync(sockPath); } catch { /* doesn't exist */ }
  }

  const server = net.createServer((conn) => {
    let buf = "";
    conn.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let req: { id: string; tool: string; args: unknown; settingsPath?: string };
        try { req = JSON.parse(line); } catch { continue; }
        const sp = req.settingsPath ?? settingsPath;
        handleTool(req.tool, req.args, sp)
          .then((result) => conn.write(JSON.stringify({ id: req.id, result }) + "\n"))
          .catch((err) => conn.write(JSON.stringify({ id: req.id, error: String(err) }) + "\n"));
      }
    });
  });

  server.listen(sockPath, () => {
    // Signal to the extension that the socket is ready
    process.stderr.write(`POIROT_SOCKET:${sockPath}\n`);
  });
}

// ── MCP stdio server ──────────────────────────────────────────────────────────

async function runMcpServer(): Promise<void> {
  const settingsPath = getSettingsPath();
  const sockPath = socketPathForSettings(settingsPath);
  startSocketServer(sockPath, settingsPath);

  const server = new Server(
    { name: "poirot", version: "0.0.2" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_translation_keys",
        description:
          "Create one or more i18n translation keys. Pass a single entry or multiple — always use this tool, never hardcode strings. " +
          "Supports runtime variables: include {placeholders} in the value (e.g. \"You have {count} messages\") and paraglide will type the generated function accordingly (m.key({ count: n })). " +
          "Returns the exact key reference and base value for each entry so you know precisely which m.key() to insert.",
        inputSchema: {
          type: "object" as const,
          properties: {
            entries: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  value: { type: "string", description: "The user-visible text in the base locale" },
                },
                required: ["value"],
              },
            },
          },
          required: ["entries"],
        },
      },
      {
        name: "set_translation_values",
        description:
          "Set translation values for one or more (key, locale) pairs. Use this to add or fix translations in any locale. " +
          "Returns a confirmation of every write with the exact key, locale and value that was stored.",
        inputSchema: {
          type: "object" as const,
          properties: {
            entries: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  key:    { type: "string", description: "Existing key name" },
                  locale: { type: "string", description: "Locale code (e.g. de, fr, en)" },
                  value:  { type: "string", description: "Translation value" },
                },
                required: ["key", "locale", "value"],
              },
            },
          },
          required: ["entries"],
        },
      },
      {
        name: "rename_translation_keys",
        description:
          "Rename one or more translation keys to new auto-generated names. " +
          "Returns the exact old→new mapping so you can update all usages in code.",
        inputSchema: {
          type: "object" as const,
          properties: {
            keys: {
              type: "array",
              minItems: 1,
              items: { type: "string", description: "Current key name to rename" },
            },
          },
          required: ["keys"],
        },
      },
      {
        name: "auto_translate",
        description:
          "Run machine-translate to fill all missing locale values. " +
          "Call once at the very end of a session after all keys are created — never mid-session.",
        inputSchema: { type: "object" as const, properties: {}, required: [] },
      },
      {
        name: "check_paraglide",
        description:
          "Compile paraglide and report missing or orphan keys across all locales. " +
          "Call after larger batches of changes to verify consistency.",
        inputSchema: { type: "object" as const, properties: {}, required: [] },
      },
    ],
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
