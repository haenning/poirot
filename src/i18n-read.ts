import type { InlangConfig, LocaleMap } from "./inlang";
import { getAllKeys } from "./inlang";
import { getSearchLocales } from "./lookup";

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;

export interface TranslationEntry {
  key: string;
  values: Record<string, string>;
}

export interface MissingReport {
  locale: string;
  missing: string[];
  orphans: string[];
}

export function getTranslations(
  localeMap: LocaleMap,
  config: InlangConfig,
  keys: string[],
  locales?: string[]
): TranslationEntry[] {
  const searchLocales = getSearchLocales(config, locales);
  return keys.map((key) => {
    const values: Record<string, string> = {};
    for (const locale of searchLocales) {
      const value = localeMap[locale]?.[key];
      if (value !== undefined && value !== "") {
        values[locale] = value;
      }
    }
    return { key, values };
  });
}

export function formatTranslations(entries: TranslationEntry[]): string {
  return entries
    .map(({ key, values }) => {
      const pairs = Object.entries(values)
        .map(([locale, value]) => `[${locale}] "${value}"`)
        .join("  ");
      if (pairs.length === 0) {
        return `m.${key}()  (not found)`;
      }
      return `m.${key}()  ${pairs}`;
    })
    .join("\n");
}

export function listTranslationKeys(
  localeMap: LocaleMap,
  config: InlangConfig,
  options?: {
    prefix?: string;
    contains?: string;
    missingInLocale?: string;
    limit?: number;
    offset?: number;
  }
): { total: number; keys: TranslationEntry[] } {
  const limit = Math.min(options?.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
  const offset = options?.offset ?? 0;
  const prefix = options?.prefix?.toLowerCase();
  const contains = options?.contains?.toLowerCase();
  const missingInLocale = options?.missingInLocale;

  if (missingInLocale && !config.locales.includes(missingInLocale)) {
    throw new Error(`Unknown locale: ${missingInLocale}. Available: ${config.locales.join(", ")}`);
  }

  let keys = getAllKeys(localeMap, config.baseLocale);

  if (prefix) {
    keys = keys.filter((k) => k.toLowerCase().startsWith(prefix));
  }

  if (contains) {
    keys = keys.filter((k) => {
      if (k.toLowerCase().includes(contains)) return true;
      const baseValue = localeMap[config.baseLocale]?.[k] ?? "";
      return baseValue.toLowerCase().includes(contains);
    });
  }

  if (missingInLocale) {
    keys = keys.filter((k) => {
      const value = localeMap[missingInLocale]?.[k];
      return value === undefined || value === "";
    });
  }

  keys.sort();
  const total = keys.length;
  const slice = keys.slice(offset, offset + limit);

  return {
    total,
    keys: slice.map((key) => {
      const values: Record<string, string> = {};
      for (const locale of config.locales) {
        const value = localeMap[locale]?.[key];
        if (value !== undefined && value !== "") {
          values[locale] = value;
        }
      }
      return { key, values };
    }),
  };
}

export function formatListResult(
  result: { total: number; keys: TranslationEntry[] },
  offset: number
): string {
  if (result.total === 0) {
    return "No keys match the filter.";
  }

  const header = `Showing ${result.keys.length} of ${result.total} key(s) (offset ${offset}):`;
  const lines = result.keys.map(({ key, values }) => {
    const pairs = Object.entries(values)
      .map(([locale, value]) => `[${locale}] "${value}"`)
      .join("  ");
    return `  m.${key}()  ${pairs || "(empty)"}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

export function formatI18nConfig(config: InlangConfig, localeMap: LocaleMap): string {
  const baseKeys = getAllKeys(localeMap, config.baseLocale);
  const counts = config.locales
    .map((locale) => {
      const messages = localeMap[locale] ?? {};
      const filled = baseKeys.filter((k) => {
        const v = messages[k];
        return v !== undefined && v !== "";
      }).length;
      return `  ${locale}: ${filled}/${baseKeys.length} keys filled`;
    })
    .join("\n");

  return [
    `Project: ${config.projectDir}`,
    `Base locale: ${config.baseLocale}`,
    `Locales: ${config.locales.join(", ")}`,
    `Message path pattern: ${config.pathPattern}`,
    `Paraglide outdir: ${config.paraglideOutdir ?? "(not detected)"}`,
    `Base keys: ${baseKeys.length}`,
    "Locale fill:",
    counts,
  ].join("\n");
}

/** Keys present in non-base locale files but absent from the base locale. */
export function collectOrphanKeys(localeMap: LocaleMap, config: InlangConfig): string[] {
  const baseKeys = new Set(getAllKeys(localeMap, config.baseLocale));
  const orphans = new Set<string>();
  for (const locale of config.locales) {
    if (locale === config.baseLocale) continue;
    for (const k of Object.keys(localeMap[locale] ?? {})) {
      if (k !== "$schema" && !baseKeys.has(k)) {
        orphans.add(k);
      }
    }
  }
  return [...orphans].sort();
}

export function reportMissingTranslations(
  localeMap: LocaleMap,
  config: InlangConfig
): MissingReport[] {
  const baseKeys = getAllKeys(localeMap, config.baseLocale);
  const reports: MissingReport[] = [];

  for (const locale of config.locales) {
    if (locale === config.baseLocale) continue;
    const messages = localeMap[locale] ?? {};
    const missing = baseKeys.filter((k) => {
      const v = messages[k];
      return v === undefined || v === "";
    });
    const orphans = Object.keys(messages).filter(
      (k) => k !== "$schema" && !baseKeys.includes(k)
    );
    if (missing.length > 0 || orphans.length > 0) {
      reports.push({ locale, missing, orphans });
    }
  }

  return reports;
}

export function formatMissingReport(
  reports: MissingReport[],
  baseKeyCount: number
): string {
  if (reports.length === 0) {
    return `All ${baseKeyCount} base keys present in every locale. No orphan keys.`;
  }

  return reports
    .map(({ locale, missing, orphans }) => {
      const parts: string[] = [`${locale}:`];
      if (missing.length > 0) {
        const preview = missing.slice(0, 10).join(", ");
        const more = missing.length > 10 ? ` … +${missing.length - 10} more` : "";
        parts.push(`  missing ${missing.length}: ${preview}${more}`);
      }
      if (orphans.length > 0) {
        const preview = orphans.slice(0, 5).join(", ");
        const more = orphans.length > 5 ? ` … +${orphans.length - 5} more` : "";
        parts.push(`  orphans ${orphans.length}: ${preview}${more}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}
