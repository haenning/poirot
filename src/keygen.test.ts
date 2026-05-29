import { describe, it, expect } from "vitest";
import { generateKey, generateUniqueKey } from "./keygen";

describe("keygen", () => {
  it("generates lowercase adjective_adjective_animal keys", () => {
    const key = generateKey();
    expect(key).toMatch(/^[a-z]+_[a-z]+_[a-z]+$/);
  });

  it("avoids collisions with existing keys", () => {
    const existing = new Set(["alpha_beta_gamma"]);
    const key = generateUniqueKey(existing);
    expect(existing.has(key)).toBe(false);
  });
});
