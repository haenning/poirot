import { describe, it, expect } from "vitest";
import path from "path";
import {
  assertPathContained,
  isPathInsideRoots,
  validateLocaleCode,
  validatePathPattern,
} from "./path-security";

describe("path-security", () => {
  it("assertPathContained allows paths inside project", () => {
    const base = "/tmp/project";
    expect(() => assertPathContained(base, path.join(base, "messages/en.json"))).not.toThrow();
  });

  it("assertPathContained rejects traversal", () => {
    const base = "/tmp/project";
    expect(() => assertPathContained(base, "/tmp/outside/en.json")).toThrow(/escapes project/);
  });

  it("isPathInsideRoots checks workspace membership", () => {
    expect(isPathInsideRoots("/ws/app/project.inlang/settings.json", ["/ws/app"])).toBe(true);
    expect(isPathInsideRoots("/other/settings.json", ["/ws/app"])).toBe(false);
  });

  it("validateLocaleCode rejects path-like locales", () => {
    expect(() => validateLocaleCode("en")).not.toThrow();
    expect(() => validateLocaleCode("../en")).toThrow(/Invalid locale/);
  });

  it("validatePathPattern rejects parent segments", () => {
    expect(() => validatePathPattern("./messages/{locale}.json")).not.toThrow();
    expect(() => validatePathPattern("../outside/{locale}.json")).toThrow(/Invalid path pattern/);
  });
});
