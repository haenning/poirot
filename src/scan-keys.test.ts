import { describe, it, expect } from "vitest";
import { scanKeysFromText, scanKeyMatchesFromText } from "./scan-keys";

describe("scan-keys", () => {
  it("finds m.key() calls in code", () => {
    const keys = scanKeysFromText('const x = m.hello_world();');
    expect(keys).toEqual(["hello_world"]);
  });

  it("skips line comments", () => {
    const keys = scanKeysFromText("// m.ignored_key()\nm.used_key()");
    expect(keys).toEqual(["used_key"]);
  });

  it("skips block comments", () => {
    const keys = scanKeysFromText("/* m.blocked_key() */ m.visible_key()");
    expect(keys).toEqual(["visible_key"]);
  });

  it("returns match positions", () => {
    const matches = scanKeyMatchesFromText("m.alpha() m.beta()");
    expect(matches.map((m) => m.key)).toEqual(["alpha", "beta"]);
    expect(matches[0].index).toBe(0);
  });
});
