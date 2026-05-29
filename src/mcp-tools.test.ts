import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { handleTool } from "./mcp-tools";
import { resetWriteCoordinatorForTests } from "./write-coordinator";
import { copyFixtureToTemp, settingsPathIn } from "../test/helpers";

describe("mcp-tools", () => {
  let projectRoot = "";
  let settingsPath = "";

  beforeEach(async () => {
    resetWriteCoordinatorForTests();
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    settingsPath = settingsPathIn(projectRoot);
  });

  afterEach(async () => {
    await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("create_translation_keys adds keys to locale files", async () => {
    const result = await handleTool(
      "create_translation_keys",
      { entries: [{ value: "Save changes" }] },
      settingsPath
    );
    expect(result.content[0].text).toMatch(/^m\.[a-z0-9_]+\(\)/);
    const en = JSON.parse(
      await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8")
    );
    expect(Object.values(en)).toContain("Save changes");
  });

  it("set_translation_values updates a locale", async () => {
    const result = await handleTool(
      "set_translation_values",
      { entries: [{ key: "hello_world", locale: "de", value: "Hallo Welt" }] },
      settingsPath
    );
    expect(result.content[0].text).toContain("✓");
    const de = JSON.parse(
      await fs.promises.readFile(`${projectRoot}/messages/de.json`, "utf8")
    );
    expect(de.hello_world).toBe("Hallo Welt");
  });

  it("serializes concurrent writes with mutex", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        handleTool(
          "create_translation_keys",
          { entries: [{ value: `Parallel ${i}` }] },
          settingsPath
        )
      )
    );
    expect(results).toHaveLength(10);
    const en = JSON.parse(
      await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8")
    );
    const created = Object.keys(en).filter((k) => k !== "$schema" && k !== "hello_world");
    expect(created.length).toBe(10);
  });

  it("rejects unknown tools", async () => {
    await expect(handleTool("unknown_tool", {}, settingsPath)).rejects.toThrow(/Unknown tool/);
  });

  it("bulk_lookup_translations searches keys without writing", async () => {
    const before = await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8");
    const result = await handleTool(
      "bulk_lookup_translations",
      { queries: ["Hello", "missing_xyz"], locales: ["en", "de"] },
      settingsPath
    );
    const after = await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8");
    expect(after).toBe(before);
    expect(result.content[0].text).toContain('Query "Hello"');
    expect(result.content[0].text).toContain("m.hello_world()");
    expect(result.content[0].text).toContain('Query "missing_xyz"');
    expect(result.content[0].text).toContain("(no matches)");
  });
});
