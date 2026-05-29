import { execFileSync } from "child_process";
import { readInlangConfig, readAllLocales, getAllKeys, addKey, setLocaleValue, renameKey } from "./inlang";
import { generateUniqueKey } from "./keygen";
import { withProjectWrite } from "./write-coordinator";
import {
  bulkLookupTranslations,
  formatBulkLookupResults,
  getSearchLocales,
} from "./lookup";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

function execCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): string {
  return execFileSync(command, args, {
    cwd,
    timeout: timeoutMs,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
}

function onReload(): void {
  process.stderr.write("POIROT_RELOAD\n");
}

const READ_ONLY_TOOLS = new Set(["bulk_lookup_translations"]);

export async function handleTool(
  name: string,
  args: unknown,
  settingsPath: string
): Promise<ToolResult> {
  if (READ_ONLY_TOOLS.has(name)) {
    return executeTool(name, args, settingsPath);
  }
  return withProjectWrite(settingsPath, () => executeTool(name, args, settingsPath));
}

async function executeTool(
  name: string,
  args: unknown,
  settingsPath: string
): Promise<ToolResult> {
    if (name === "bulk_lookup_translations") {
      const { queries, locales } = args as { queries: string[]; locales?: string[] };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const searchLocales = getSearchLocales(config, locales);
      const results = bulkLookupTranslations(localeMap, config, queries, { locales });
      const text = formatBulkLookupResults(results, searchLocales);
      return { content: [{ type: "text" as const, text }] };
    }

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

      onReload();
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    if (name === "set_translation_values") {
      const { entries } = args as {
        entries: Array<{ key: string; locale: string; value: string }>;
      };
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

      onReload();
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

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

      onReload();
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    if (name === "auto_translate") {
      const config = await readInlangConfig(settingsPath);
      try {
        const npm = process.platform === "win32" ? "npm.cmd" : "npm";
        const output = execCommand(npm, ["run", "machine-translate"], config.projectDir, 60000);
        onReload();
        return {
          content: [{ type: "text" as const, text: output.trim() || "machine-translate completed." }],
        };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return {
          content: [
            {
              type: "text" as const,
              text: `machine-translate failed:\n${(e.stderr ?? e.stdout ?? e.message ?? String(err)).trim()}`,
            },
          ],
        };
      }
    }

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
          issues.push(
            `${locale}: missing ${missing.length} key(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` … +${missing.length - 5} more` : ""}`
          );
        }
        const orphans = Object.keys(messages).filter(
          (k) => k !== "$schema" && !baseKeys.includes(k)
        );
        if (orphans.length > 0) {
          issues.push(`${locale}: ${orphans.length} orphan key(s): ${orphans.slice(0, 3).join(", ")}`);
        }
      }

      let compileOutput = "";
      try {
        const npx = process.platform === "win32" ? "npx.cmd" : "npx";
        const compileArgs = ["--yes", "@inlang/paraglide-js", "compile", "--project", "project.inlang"];
        if (config.paraglideOutdir) {
          compileArgs.push("--outdir", config.paraglideOutdir);
        }
        const result = execCommand(npx, compileArgs, config.projectDir, 30000);
        compileOutput = `Paraglide compile: OK\n${result ?? ""}`.trim();
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        compileOutput = `Paraglide compile failed:\n${(e.stderr ?? e.stdout ?? e.message ?? String(err)).trim()}`;
      }

      const keyReport =
        issues.length === 0
          ? `All ${baseKeys.length} base keys present in every locale.`
          : `Key issues:\n${issues.join("\n")}`;

      return { content: [{ type: "text" as const, text: `${keyReport}\n\n${compileOutput}` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
}

export const MCP_TOOL_DEFINITIONS = [
  {
    name: "bulk_lookup_translations",
    description:
      "Search existing translation keys by key name or translated value. " +
      "Pass one or many search strings; each returns up to 5 matches with m.key() references and locale values. " +
      "Omit locales to search all languages, or pass specific locale codes (e.g. [\"en\", \"de\"]) to match only in those languages. " +
      "Use before creating keys to reuse existing translations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        queries: {
          type: "array",
          minItems: 1,
          items: { type: "string", description: "Search term — matched against key names and translation values" },
        },
        locales: {
          type: "array",
          items: { type: "string", description: "Optional locale codes to search in; omit to search all configured locales" },
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "create_translation_keys",
    description:
      "Create one or more i18n translation keys. Pass a single entry or multiple — always use this tool, never hardcode strings. " +
      'Supports runtime variables: include {placeholders} in the value (e.g. "You have {count} messages") and paraglide will type the generated function accordingly (m.key({ count: n })). ' +
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
              key: { type: "string", description: "Existing key name" },
              locale: { type: "string", description: "Locale code (e.g. de, fr, en)" },
              value: { type: "string", description: "Translation value" },
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
] as const;
