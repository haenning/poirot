export const MAX_IPC_MESSAGE_BYTES = 1024 * 1024;

export interface IpcToolRequest {
  id: string;
  tool: string;
  args: unknown;
  settingsPath?: string;
}

export interface IpcToolResponse {
  id: string;
  result?: { content: Array<{ type: "text"; text: string }> };
  error?: string;
}

export function assertIpcMessageSize(payload: unknown): void {
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (size > MAX_IPC_MESSAGE_BYTES) {
    throw new Error(`IPC message exceeds ${MAX_IPC_MESSAGE_BYTES} bytes`);
  }
}
