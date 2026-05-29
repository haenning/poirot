import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  readInlangConfig,
  readAllLocales,
  resolveLocalePath,
  addKey,
  setLocaleValue,
  renameKey,
  getAllKeys,
} from "./inlang";
import { copyFixtureToTemp, settingsPathIn } from "../test/helpers";

describe("inlang", () => {
  let projectRoot = "";
  let settingsPath = "";

  beforeEach(async () => {
    projectRoot = await copyFixtureToTemp("minimal-inlang");
    settingsPath = settingsPathIn(projectRoot);
  });

  afterEach(async () => {
    await fs.promises.rm(projectRoot, { recursive: true, force: true });
  });

  it("reads settings and locale files", async () => {
    const config = await readInlangConfig(settingsPath);
    expect(config.baseLocale).toBe("en");
    expect(config.locales).toEqual(["en", "de"]);
    const localeMap = await readAllLocales(config);
    expect(localeMap.en.hello_world).toBe("Hello");
    expect(localeMap.de.hello_world).toBe("Hallo");
  });

  it("resolves locale paths inside project", async () => {
    const config = await readInlangConfig(settingsPath);
    const localePath = resolveLocalePath(config, "en");
    expect(localePath).toBe(path.join(projectRoot, "messages/en.json"));
  });

  it("rejects traversal path patterns", async () => {
    const badRoot = await copyFixtureToTemp("traversal-inlang");
    const badSettings = settingsPathIn(badRoot);
    await expect(readInlangConfig(badSettings)).rejects.toThrow(/Invalid path pattern/);
    await fs.promises.rm(badRoot, { recursive: true, force: true });
  });

  it("addKey writes all locales", async () => {
    const config = await readInlangConfig(settingsPath);
    const localeMap = await readAllLocales(config);
    await addKey(config, localeMap, "new_key", "New value");
    const enRaw = JSON.parse(await fs.promises.readFile(resolveLocalePath(config, "en"), "utf8"));
    const deRaw = JSON.parse(await fs.promises.readFile(resolveLocalePath(config, "de"), "utf8"));
    expect(enRaw.new_key).toBe("New value");
    expect(deRaw.new_key).toBe("");
  });

  it("setLocaleValue rejects empty values", async () => {
    const config = await readInlangConfig(settingsPath);
    const localeMap = await readAllLocales(config);
    await expect(setLocaleValue(config, localeMap, "hello_world", "en", "   ")).rejects.toThrow(
      /must not be empty/
    );
  });

  it("renameKey moves key across locales", async () => {
    const config = await readInlangConfig(settingsPath);
    const localeMap = await readAllLocales(config);
    await renameKey(config, localeMap, "hello_world", "renamed_key");
    const keys = getAllKeys(localeMap, "en");
    expect(keys).toContain("renamed_key");
    expect(keys).not.toContain("hello_world");
  });
});
