import { execFileSync } from "child_process";
import {
  readInlangConfig,
  readAllLocales,
  getAllKeys,
  addKey,
  setLocaleValue,
  renameKey,
  deleteKey,
} from "./inlang";
import { generateUniqueKey } from "./keygen";
import { formatKeyCall } from "./key-ref";
import { withProjectWrite } from "./write-coordinator";
import {
  bulkLookupTranslations,
  formatBulkLookupResults,
  getSearchLocales,
} from "./lookup";
import {
  getTranslations,
  formatTranslations,
  listTranslationKeys,
  formatListResult,
  formatI18nConfig,
  reportMissingTranslations,
  formatMissingReport,
} from "./i18n-read";
import {
  findKeyUsages,
  formatKeyUsages,
  scanFileKeys,
  formatScanFileKeys,
} from "./key-usages";
import { validateKeyPlaceholders, formatPlaceholderIssues } from "./placeholders";

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

const READ_ONLY_TOOLS = new Set([
  "bulk_lookup_translations",
  "get_translations",
  "get_i18n_config",
  "list_translation_keys",
  "report_missing_translations",
  "validate_placeholders",
  "scan_file_keys",
  "find_key_usages",
]);

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

    if (name === "get_translations") {
      const { keys, locales } = args as { keys: string[]; locales?: string[] };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const entries = getTranslations(localeMap, config, keys, locales);
      return { content: [{ type: "text" as const, text: formatTranslations(entries) }] };
    }

    if (name === "get_i18n_config") {
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      return { content: [{ type: "text" as const, text: formatI18nConfig(config, localeMap) }] };
    }

    if (name === "list_translation_keys") {
      const { prefix, contains, missingInLocale, limit, offset } = args as {
        prefix?: string;
        contains?: string;
        missingInLocale?: string;
        limit?: number;
        offset?: number;
      };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const result = listTranslationKeys(localeMap, config, {
        prefix,
        contains,
        missingInLocale,
        limit,
        offset,
      });
      return {
        content: [{ type: "text" as const, text: formatListResult(result, offset ?? 0) }],
      };
    }

    if (name === "report_missing_translations") {
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const baseKeys = getAllKeys(localeMap, config.baseLocale);
      const reports = reportMissingTranslations(localeMap, config);
      return {
        content: [{ type: "text" as const, text: formatMissingReport(reports, baseKeys.length) }],
      };
    }

    if (name === "validate_placeholders") {
      const { keys } = args as { keys?: string[] };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const targetKeys = keys?.length ? keys : getAllKeys(localeMap, config.baseLocale);
      const issues = targetKeys.flatMap((key) => {
        const values: Record<string, string> = {};
        for (const locale of config.locales) {
          const value = localeMap[locale]?.[key];
          if (value !== undefined && value !== "") {
            values[locale] = value;
          }
        }
        return validateKeyPlaceholders(key, values, config.locales, config.baseLocale);
      });
      return { content: [{ type: "text" as const, text: formatPlaceholderIssues(issues) }] };
    }

    if (name === "scan_file_keys") {
      const { file } = args as { file: string };
      const config = await readInlangConfig(settingsPath);
      const result = await scanFileKeys(config.projectDir, file);
      return { content: [{ type: "text" as const, text: formatScanFileKeys(result) }] };
    }

    if (name === "find_key_usages") {
      const { keys, include } = args as { keys: string[]; include?: string[] };
      const config = await readInlangConfig(settingsPath);
      const results = await findKeyUsages(config.projectDir, keys, include);
      return { content: [{ type: "text" as const, text: formatKeyUsages(results) }] };
    }

    if (name === "delete_translation_keys") {
      const { keys, onlyIfUnused } = args as { keys: string[]; onlyIfUnused?: boolean };
      const config = await readInlangConfig(settingsPath);
      const localeMap = await readAllLocales(config);
      const lines: string[] = [];

      let usageMap: Map<string, number> | undefined;
      if (onlyIfUnused) {
        const usages = await findKeyUsages(config.projectDir, keys);
        usageMap = new Map(usages.map((u) => [u.key, u.hits.length]));
      }

      for (const key of keys) {
        if (onlyIfUnused && (usageMap!.get(key) ?? 0) > 0) {
          lines.push(`✗ m.${key}() — still used in code`);
          continue;
        }
        const deleted = await deleteKey(config, localeMap, key);
        if (deleted) {
          lines.push(`✓ deleted m.${key}()`);
        } else {
          lines.push(`✗ m.${key}() — not found`);
        }
      }

      onReload();
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
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
        lines.push(`${formatKeyCall(key, entry.value)}  [${config.baseLocale}] "${entry.value}"`);
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
      const reports = reportMissingTranslations(localeMap, config);
      const keyReport = formatMissingReport(reports, baseKeys.length);

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
    name: "get_translations",
    description:
      "Fetch exact translation values for specific keys. Use when you already know key names (e.g. from code). " +
      "Optional locales filter; omit to return all configured locales.",
    inputSchema: {
      type: "object" as const,
      properties: {
        keys: {
          type: "array",
          minItems: 1,
          items: { type: "string", description: "Exact key names to fetch" },
        },
        locales: {
          type: "array",
          items: { type: "string", description: "Optional locale codes; omit for all locales" },
        },
      },
      required: ["keys"],
    },
  },
  {
    name: "get_i18n_config",
    description:
      "Read project i18n metadata: base locale, locales, message path pattern, paraglide outdir, and key fill counts.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "list_translation_keys",
    description:
      "Browse translation keys with optional filters. Paginated (default 50, max 200). " +
      "Use prefix/contains to narrow results, or missingInLocale to find untranslated keys.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prefix: { type: "string", description: "Key name prefix filter" },
        contains: { type: "string", description: "Substring in key name or base-locale value" },
        missingInLocale: { type: "string", description: "Only keys missing/empty in this locale" },
        limit: { type: "number", description: "Max keys to return (default 50, max 200)" },
        offset: { type: "number", description: "Skip this many matching keys" },
      },
      required: [],
    },
  },
  {
    name: "report_missing_translations",
    description:
      "Lightweight health check: missing and orphan key counts per locale. No paraglide compile — use mid-session.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "validate_placeholders",
    description:
      "Check that {placeholder} names match across locales for each key. " +
      "Omit keys to validate all base keys; pass specific keys to narrow scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        keys: {
          type: "array",
          items: { type: "string", description: "Optional key names; omit to check all base keys" },
        },
      },
      required: [],
    },
  },
  {
    name: "scan_file_keys",
    description:
      "List m.key() calls used in a source file. Pass path relative to project root or absolute within the project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file: { type: "string", description: "Source file path (e.g. src/Login.svelte)" },
      },
      required: ["file"],
    },
  },
  {
    name: "find_key_usages",
    description:
      "Find source files and line numbers where m.key() is called. " +
      "Use before rename/delete. Optional include prefixes (e.g. [\"src\"]) limit the scan.",
    inputSchema: {
      type: "object" as const,
      properties: {
        keys: {
          type: "array",
          minItems: 1,
          items: { type: "string", description: "Key names to find" },
        },
        include: {
          type: "array",
          items: { type: "string", description: "Optional path prefixes to scan (default: whole project)" },
        },
      },
      required: ["keys"],
    },
  },
  {
    name: "create_translation_keys",
    description:
      "Create one or more i18n translation keys. Pass a single entry or multiple — always use this tool, never hardcode strings. " +
      'Supports runtime variables: include {placeholders} in the value (e.g. "You have {count} messages") and paraglide will type the generated function accordingly (m.key({ count: n })). ' +
      "Returns the exact paste-ready m.key() reference (with {param: a, …} slots when the value has placeholders) and base value for each entry.",
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
    name: "delete_translation_keys",
    description:
      "Remove keys from all locale files. Set onlyIfUnused to skip keys still referenced in source code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        keys: {
          type: "array",
          minItems: 1,
          items: { type: "string", description: "Key names to delete" },
        },
        onlyIfUnused: {
          type: "boolean",
          description: "If true, skip keys that still have m.key() usages in the project",
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
