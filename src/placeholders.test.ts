import { describe, it, expect } from "vitest";
import { extractPlaceholders, validateKeyPlaceholders, formatPlaceholderIssues } from "./placeholders";

describe("placeholders", () => {
  it("extracts named placeholders", () => {
    expect(extractPlaceholders("You have {count} messages from {name}")).toEqual(["count", "name"]);
  });

  it("detects mismatched placeholders across locales", () => {
    const issues = validateKeyPlaceholders(
      "greeting",
      {
        en: "Hello {name}",
        de: "Hallo {username}",
      },
      ["en", "de"],
      "en"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].locale).toBe("de");
    expect(issues[0].expected).toEqual(["name"]);
    expect(issues[0].actual).toEqual(["username"]);
  });

  it("reports ok when placeholders match", () => {
    const issues = validateKeyPlaceholders(
      "count_msg",
      {
        en: "{count} items",
        de: "{count} Elemente",
      },
      ["en", "de"],
      "en"
    );
    expect(issues).toHaveLength(0);
    expect(formatPlaceholderIssues(issues)).toContain("matching placeholders");
  });
});
