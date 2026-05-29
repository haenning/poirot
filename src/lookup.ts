import type { InlangConfig, LocaleMap } from "./inlang";
import { getAllKeys } from "./inlang";

export const LOOKUP_MAX_RESULTS = 5;

export interface LookupMatch {
  key: string;
  values: Record<string, string>;
}

export interface BulkLookupResult {
  query: string;
  matches: LookupMatch[];
}

export function getSearchLocales(config: InlangConfig, locales?: string[]): string[] {
  if (!locales || locales.length === 0) {
    return config.locales;
  }
  for (const locale of locales) {
    if (!config.locales.includes(locale)) {
      throw new Error(`Unknown locale: ${locale}. Available: ${config.locales.join(", ")}`);
    }
  }
  return locales;
}

function matchScore(key: string, values: Record<string, string>, query: string): number {
  const q = query.toLowerCase();
  const keyLower = key.toLowerCase();
  if (keyLower === q) return 0;
  if (keyLower.startsWith(q)) return 1;
  if (keyLower.includes(q)) return 2;
  for (const value of Object.values(values)) {
    const v = value.toLowerCase();
    if (v === q) return 3;
    if (v.startsWith(q)) return 4;
    if (v.includes(q)) return 5;
  }
  return -1;
}

/** Search keys/values; returns up to `limit` matches sorted by relevance. */
export function lookupTranslations(
  localeMap: LocaleMap,
  config: InlangConfig,
  query: string,
  options?: { locales?: string[]; limit?: number }
): LookupMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = options?.limit ?? LOOKUP_MAX_RESULTS;
  const searchLocales = getSearchLocales(config, options?.locales);
  const keys = getAllKeys(localeMap, config.baseLocale);

  const ranked: Array<{ score: number; key: string }> = [];
  for (const key of keys) {
    const values: Record<string, string> = {};
    for (const locale of searchLocales) {
      const value = localeMap[locale]?.[key];
      if (value !== undefined && value !== "") {
        values[locale] = value;
      }
    }
    const score = matchScore(key, values, trimmed);
    if (score >= 0) {
      ranked.push({ score, key });
    }
  }

  ranked.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));

  return ranked.slice(0, limit).map(({ key }) => {
    const values: Record<string, string> = {};
    for (const locale of config.locales) {
      const value = localeMap[locale]?.[key];
      if (value !== undefined && value !== "") {
        values[locale] = value;
      }
    }
    return { key, values };
  });
}

export function bulkLookupTranslations(
  localeMap: LocaleMap,
  config: InlangConfig,
  queries: string[],
  options?: { locales?: string[]; limit?: number }
): BulkLookupResult[] {
  return queries.map((query) => ({
    query,
    matches: lookupTranslations(localeMap, config, query, options),
  }));
}

export function formatBulkLookupResults(
  results: BulkLookupResult[],
  searchLocales: string[]
): string {
  const localeHint =
    searchLocales.length > 0 ? searchLocales.join(", ") : "all configured locales";

  return results
    .map(({ query, matches }) => {
      const header = `Query "${query}" (searched: ${localeHint}, max ${LOOKUP_MAX_RESULTS}):`;
      if (matches.length === 0) {
        return `${header}\n  (no matches)`;
      }
      const lines = matches.map((m, i) => {
        const pairs = Object.entries(m.values)
          .map(([locale, value]) => `[${locale}] "${value}"`)
          .join("  ");
        return `  ${i + 1}. m.${m.key}()  ${pairs}`;
      });
      return `${header}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
