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

function createNamespace(transport: RelayTransport, prefix: string): any {
  const handler = async (args?: unknown) => {
    try {
      const result = await transport.rpc(prefix, args ?? {});
      return wrapResult(result);
    } catch (e) {
      return { error: { message: (e as Error).message, name: "RpcError" } };
    }
  };
  return new Proxy(handler, {
    get: (_target, fn: string) => {
      if (fn === "then" || fn === "toJSON" || typeof fn !== "string") return undefined;
      return createNamespace(transport, `${prefix}.${fn}`);
    },
  });
}

export function createProxyClient(transport: RelayTransport): any {
  const namespaces = ["session", "config", "project", "path", "vcs", "command", "provider", "find", "file", "fs", "app", "mcp", "lsp", "tui", "auth", "global", "instance", "pty", "tool", "db"];
  const client: Record<string, unknown> = {};
  for (const ns of namespaces) {
    client[ns] = createNamespace(transport, ns);
  }
  client.postSessionIdPermissionsPermissionId = createNamespace(transport, "postSessionIdPermissionsPermissionId");
  return client;
}
