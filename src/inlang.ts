import fs from "fs";
import path from "path";
import { atomicWriteJson } from "./atomic";

export interface InlangConfig {
  settingsPath: string;
  baseLocale: string;
  locales: string[];
  pathPattern: string;
  projectDir: string;
}

export type LocaleMap = Record<string, Record<string, string>>;

export async function readInlangConfig(settingsPath: string): Promise<InlangConfig> {
  const raw = await fs.promises.readFile(settingsPath, "utf8");
  const settings = JSON.parse(raw);

  const baseLocale: string = settings.baseLocale ?? settings.sourceLanguageTag ?? "en";
  const locales: string[] = settings.locales ?? settings.languageTags ?? [baseLocale];

  // Find pathPattern — check the top-level plugin config key first (real inlang format),
  // then fall back to scanning the modules array for older shapes
  let pathPattern = "./messages/{locale}.json";
  const pluginConfig = settings["plugin.inlang.messageFormat"] as Record<string, unknown> | undefined;
  if (pluginConfig?.pathPattern && typeof pluginConfig.pathPattern === "string") {
    pathPattern = pluginConfig.pathPattern;
  } else {
    const modules: unknown[] = settings.modules ?? settings.plugins ?? [];
    for (const mod of modules) {
      const m = mod as Record<string, unknown>;
      if (m.pathPattern && typeof m.pathPattern === "string") {
        pathPattern = m.pathPattern;
        break;
      }
      const opts = m.options as Record<string, unknown> | undefined;
      if (opts?.pathPattern && typeof opts.pathPattern === "string") {
        pathPattern = opts.pathPattern;
        break;
      }
    }
  }

  // projectDir is two levels up from settings.json (above project.inlang/)
  const projectDir = path.dirname(path.dirname(settingsPath));

  console.log("[paraglide-helper] config:", { baseLocale, locales, pathPattern, projectDir });

  return { settingsPath, baseLocale, locales, pathPattern, projectDir };
}

export function resolveLocalePath(config: InlangConfig, locale: string): string {
  return path.resolve(config.projectDir, config.pathPattern.replace("{locale}", locale));
}

export async function readAllLocales(config: InlangConfig): Promise<LocaleMap> {
  const result: LocaleMap = {};
  await Promise.all(
    config.locales.map(async (locale) => {
      const filePath = resolveLocalePath(config, locale);
      console.log("[paraglide-helper] reading locale file:", filePath);
      try {
        const raw = await fs.promises.readFile(filePath, "utf8");
        result[locale] = JSON.parse(raw);
        console.log("[paraglide-helper] loaded", locale, "keys:", Object.keys(result[locale]).length);
      } catch (err) {
        console.log("[paraglide-helper] failed to read", filePath, String(err));
        result[locale] = {};
      }
    })
  );
  return result;
}

export async function writeLocaleFile(
  config: InlangConfig,
  locale: string,
  data: Record<string, string>
): Promise<void> {
  const filePath = resolveLocalePath(config, locale);
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await atomicWriteJson(filePath, data);
}

export function getAllKeys(localeMap: LocaleMap, baseLocale: string): string[] {
  return Object.keys(localeMap[baseLocale] ?? {}).filter((k) => k !== "$schema");
}

export async function addKey(
  config: InlangConfig,
  localeMap: LocaleMap,
  key: string,
  baseValue: string
): Promise<void> {
  await Promise.all(
    config.locales.map((locale) => {
      const data = { ...(localeMap[locale] ?? {}) };
      data[key] = locale === config.baseLocale ? baseValue : "";
      localeMap[locale] = data;
      return writeLocaleFile(config, locale, data);
    })
  );
}

export async function saveKeyEdits(
  config: InlangConfig,
  localeMap: LocaleMap,
  key: string,
  edits: Record<string, string>
): Promise<void> {
  await Promise.all(
    Object.entries(edits).map(([locale, value]) => {
      const data = { ...(localeMap[locale] ?? {}) };
      data[key] = value;
      localeMap[locale] = data;
      return writeLocaleFile(config, locale, data);
    })
  );
}
