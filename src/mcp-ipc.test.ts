import { describe, it, expect } from "vitest";
import { assertIpcMessageSize, MAX_IPC_MESSAGE_BYTES } from "./mcp-ipc";

describe("mcp-ipc", () => {
  it("allows messages under size limit", () => {
    expect(() => assertIpcMessageSize({ id: "1", tool: "test", args: {} })).not.toThrow();
  });

  it("rejects oversized messages", () => {
    const huge = "x".repeat(MAX_IPC_MESSAGE_BYTES);
    expect(() => assertIpcMessageSize({ id: "1", tool: "test", args: { huge } })).toThrow(
      /exceeds/
    );
  });
});
