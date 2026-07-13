import type { RelayTransport } from "./relay-transport.js";

export interface RpcClient {
  rpc: (method: string, args: unknown) => Promise<unknown>;
}

export function createRpcClient(transport: RelayTransport): RpcClient {
  return {
    rpc: (method: string, args: unknown) => transport.rpc(method, args),
  };
}

export interface SdkResult<T> {
  data?: T;
  error?: { message: string; name?: string };
}

function wrapResult<T>(result: unknown): SdkResult<T> {
  if (result === null || result === undefined) return { data: undefined as T };
  if (typeof result === "object" && ("data" in result || "error" in result)) {
    return result as SdkResult<T>;
  }
  return { data: result as T };
}

function sdkCall(transport: RelayTransport, method: string) {
  return async (args?: unknown): Promise<SdkResult<unknown>> => {
    try {
      const result = await transport.rpc(method, args ?? {});
      return wrapResult(result);
    } catch (e) {
      return { error: { message: (e as Error).message, name: "RpcError" } };
    }
  };
}

function createNamespace(transport: RelayTransport, ns: string): Record<string, unknown> {
  return new Proxy({}, {
    get: (_target, fn: string) => {
      if (fn === "then" || fn === "toJSON" || typeof fn !== "string") return undefined;
      return sdkCall(transport, `${ns}.${fn}`);
    },
  });
}

export function createProxyClient(transport: RelayTransport): unknown {
  const namespaces = ["session", "config", "project", "path", "vcs", "command", "provider", "find", "file", "fs", "app", "mcp", "lsp", "tui", "auth", "global", "instance", "pty", "tool"];
  const client: Record<string, unknown> = {};
  for (const ns of namespaces) {
    client[ns] = createNamespace(transport, ns);
  }
  client.postSessionIdPermissionsPermissionId = sdkCall(transport, "postSessionIdPermissionsPermissionId");
  return client as unknown;
}
