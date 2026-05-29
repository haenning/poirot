import { describe, it, expect } from "vitest";
import { formatKeyCall } from "./key-ref";

describe("formatKeyCall", () => {
  it("returns plain call without placeholders", () => {
    expect(formatKeyCall("brave_fox", "Submit")).toBe("m.brave_fox()");
  });

  it("includes param object with placeholder slots", () => {
    expect(formatKeyCall("msg_key", "You have {count} messages from {name}")).toBe(
      "m.msg_key({ count: a, name: b })"
    );
  });
});
