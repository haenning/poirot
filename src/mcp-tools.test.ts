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

  it("create_translation_keys returns param slots for placeholders", async () => {
    const result = await handleTool(
      "create_translation_keys",
      { entries: [{ value: "Hello {name}, you have {count} items" }] },
      settingsPath
    );
    expect(result.content[0].text).toMatch(/^m\.[a-z0-9_]+\(\{ count: a, name: b \}\)/);
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

  it("get_translations fetches exact keys without writing", async () => {
    const before = await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8");
    const result = await handleTool(
      "get_translations",
      { keys: ["hello_world", "missing_key"] },
      settingsPath
    );
    const after = await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8");
    expect(after).toBe(before);
    expect(result.content[0].text).toContain("m.hello_world()");
    expect(result.content[0].text).toContain("(not found)");
  });

  it("scan_file_keys lists keys in a file", async () => {
    const result = await handleTool("scan_file_keys", { file: "src/sample.ts" }, settingsPath);
    expect(result.content[0].text).toContain("m.hello_world()");
  });

  it("report_missing_translations is read-only", async () => {
    const before = await fs.promises.readFile(`${projectRoot}/messages/de.json`, "utf8");
    const result = await handleTool("report_missing_translations", {}, settingsPath);
    const after = await fs.promises.readFile(`${projectRoot}/messages/de.json`, "utf8");
    expect(after).toBe(before);
    expect(result.content[0].text.length).toBeGreaterThan(0);
  });

  it("delete_translation_keys removes unused key with onlyIfUnused", async () => {
    await fs.promises.writeFile(
      path.join(projectRoot, "src", "extra.ts"),
      "export const x = m.hello_world();\n",
      "utf8"
    );
    const blocked = await handleTool(
      "delete_translation_keys",
      { keys: ["hello_world"], onlyIfUnused: true },
      settingsPath
    );
    expect(blocked.content[0].text).toContain("still used");

    await fs.promises.rm(path.join(projectRoot, "src", "extra.ts"));
    await fs.promises.rm(path.join(projectRoot, "src", "sample.ts"));
    const deleted = await handleTool(
      "delete_translation_keys",
      { keys: ["hello_world"], onlyIfUnused: true },
      settingsPath
    );
    expect(deleted.content[0].text).toContain("✓ deleted");
    const en = JSON.parse(
      await fs.promises.readFile(`${projectRoot}/messages/en.json`, "utf8")
    );
    expect(en.hello_world).toBeUndefined();
  });

  it("delete_translation_keys removes orphan keys not in base locale", async () => {
    const dePath = `${projectRoot}/messages/de.json`;
    const de = JSON.parse(await fs.promises.readFile(dePath, "utf8"));
    de.stale_orphan = "Alte Übersetzung";
    await fs.promises.writeFile(dePath, JSON.stringify(de, null, 2));

    const result = await handleTool(
      "delete_translation_keys",
      { keys: ["stale_orphan"] },
      settingsPath
    );
    expect(result.content[0].text).toContain("✓ deleted");
    const deAfter = JSON.parse(await fs.promises.readFile(dePath, "utf8"));
    expect(deAfter.stale_orphan).toBeUndefined();
  });
});
