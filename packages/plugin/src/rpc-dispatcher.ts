import { existsSync } from "node:fs";
import type { OpencodeClient } from "@opencode-ai/sdk/client";

export type RpcDispatcher = (method: string, args: unknown) => Promise<unknown>;

export function createRpcDispatcher(client: OpencodeClient): RpcDispatcher {
  return async (method: string, args: unknown): Promise<unknown> => {
    if (method === "fs.exists") {
      const path = (args as { path?: string })?.path;
      if (!path) throw new Error("fs.exists: path required");
      return existsSync(path);
    }
    if (method === "fs.existsBatch") {
      const paths = (args as { paths?: string[] })?.paths;
      if (!Array.isArray(paths)) throw new Error("fs.existsBatch: paths array required");
      return paths.map((p) => existsSync(p));
    }
    const parts = method.split(".");
    if (parts.length < 2) {
      throw new Error(`invalid method: ${method}`);
    }
    const [ns, fn] = parts;
    const target = (client as unknown as Record<string, unknown>)[ns];
    if (!target || typeof target !== "object") {
      throw new Error(`unknown namespace: ${ns}`);
    }
    const handler = (target as Record<string, unknown>)[fn];
    if (typeof handler !== "function") {
      throw new Error(`unknown method: ${method}`);
    }
    const result = await (handler as Function).call(target, args);
    return serializeResult(result);
  };
}

function serializeResult(result: unknown): unknown {
  if (result === undefined || result === null) return null;
  if (typeof result !== "object") return result;
  return JSON.parse(JSON.stringify(result));
}
