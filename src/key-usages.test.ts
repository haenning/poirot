import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { findKeyUsages, scanFileKeys, scanFileKeysFromText } from "./key-usages";
import { copyFixtureToTemp } from "../test/helpers";

describe("key-usages", () => {
  let projectRoot = "";

  beforeEach(async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
  });

  afterEach(async () => {
    await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("scanFileKeysFromText finds plain and parameterized calls", () => {
    const keys = scanFileKeysFromText('m.hello_world(); m.other({ count: 1 });');
    expect(keys).toEqual(["hello_world", "other"]);
  });

  it("scanFileKeys reads a project file", async () => {
    const result = await scanFileKeys(projectRoot, "src/sample.ts");
    expect(result.keys).toContain("hello_world");
  });

  it("findKeyUsages locates key in source", async () => {
    const results = await findKeyUsages(projectRoot, ["hello_world"], ["src"]);
    expect(results[0].hits.some((h) => h.file === "src/sample.ts")).toBe(true);
  });

  it("rejects paths outside project", async () => {
    await expect(scanFileKeys(projectRoot, "/etc/passwd")).rejects.toThrow(/escapes project/);
  });
});
