import { describe, it, expect } from "vitest";
import {
  lookupTranslations,
  bulkLookupTranslations,
  formatBulkLookupResults,
  LOOKUP_MAX_RESULTS,
} from "./lookup";
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
  en: {
    submit_form: "Submit form",
    cancel_action: "Cancel",
    welcome_user: "Welcome back",
    delete_item: "Delete",
    save_changes: "Save changes",
    find_document: "Find document",
  },
  de: {
    submit_form: "Formular absenden",
    cancel_action: "Abbrechen",
    welcome_user: "Willkommen zurück",
    delete_item: "Löschen",
    save_changes: "Änderungen speichern",
    find_document: "Dokument suchen",
  },
  fr: {
    submit_form: "Soumettre",
    cancel_action: "Annuler",
  },
};

describe("lookup", () => {
  it("matches key names and values", () => {
    const byKey = lookupTranslations(localeMap, config, "submit");
    expect(byKey.some((m) => m.key === "submit_form")).toBe(true);

    const byValue = lookupTranslations(localeMap, config, "abbrechen", { locales: ["de"] });
    expect(byValue[0]?.key).toBe("cancel_action");
  });

  it("limits to 5 results per query", () => {
    const matches = lookupTranslations(localeMap, config, "e");
    expect(matches.length).toBeLessThanOrEqual(LOOKUP_MAX_RESULTS);
  });

  it("filters to specific locales for matching", () => {
    const matches = lookupTranslations(localeMap, config, "soumettre", { locales: ["fr"] });
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe("submit_form");
    expect(matches[0].values.fr).toBe("Soumettre");

    const enOnly = lookupTranslations(localeMap, config, "soumettre", { locales: ["en"] });
    expect(enOnly).toHaveLength(0);
  });

  it("returns all locale values on matched keys", () => {
    const matches = lookupTranslations(localeMap, config, "submit_form");
    expect(matches[0].values).toEqual({
      en: "Submit form",
      de: "Formular absenden",
      fr: "Soumettre",
    });
  });

  it("rejects unknown locale filter", () => {
    expect(() => lookupTranslations(localeMap, config, "x", { locales: ["xx"] })).toThrow(
      /Unknown locale/
    );
  });

  it("bulk lookup runs each query independently", () => {
    const results = bulkLookupTranslations(localeMap, config, ["submit", "no_such_thing"]);
    expect(results).toHaveLength(2);
    expect(results[0].matches.length).toBeGreaterThan(0);
    expect(results[1].matches).toHaveLength(0);
  });

  it("formatBulkLookupResults includes key references", () => {
    const results = bulkLookupTranslations(localeMap, config, ["cancel"], { locales: ["en", "de"] });
    const text = formatBulkLookupResults(results, ["en", "de"]);
    expect(text).toContain('Query "cancel"');
    expect(text).toContain("m.cancel_action()");
    expect(text).toContain('[en] "Cancel"');
  });
});
