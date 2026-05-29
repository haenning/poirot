import { describe, it, expect } from "vitest";
import {
  getTranslations,
  listTranslationKeys,
  reportMissingTranslations,
  formatMissingReport,
  collectOrphanKeys,
} from "./i18n-read";
import type { InlangConfig, LocaleMap } from "./inlang";

const config: InlangConfig = {
  settingsPath: "/proj/project.inlang/settings.json",
  baseLocale: "en",
  locales: ["en", "de", "fr"],
  pathPattern: "./messages/{locale}.json",
  projectDir: "/proj",
  paraglideOutdir: null,
};

const localeMap: LocaleMap = {
  en: { alpha: "Alpha", beta: "Beta {count}" },
  de: { alpha: "Alpha DE" },
  fr: { alpha: "Alpha FR", orphan_only: "Orphan" },
};

describe("i18n-read", () => {
  it("getTranslations fetches exact keys", () => {
    const entries = getTranslations(localeMap, config, ["alpha", "missing"]);
    expect(entries[0].values.en).toBe("Alpha");
    expect(entries[0].values.de).toBe("Alpha DE");
    expect(entries[1].values).toEqual({});
  });

  it("listTranslationKeys filters missing locale", () => {
    const { total, keys } = listTranslationKeys(localeMap, config, { missingInLocale: "de" });
    expect(total).toBe(1);
    expect(keys[0].key).toBe("beta");
  });

  it("collectOrphanKeys returns unique orphans across locales", () => {
    const orphans = collectOrphanKeys(localeMap, config);
    expect(orphans).toEqual(["orphan_only"]);
  });

  it("reportMissingTranslations finds missing and orphans", () => {
    const reports = reportMissingTranslations(localeMap, config);
    const de = reports.find((r) => r.locale === "de");
    expect(de?.missing).toContain("beta");
    const fr = reports.find((r) => r.locale === "fr");
    expect(fr?.missing).toContain("beta");
    expect(fr?.orphans).toContain("orphan_only");
    expect(formatMissingReport([], 2)).toContain("No orphan");
  });
});
