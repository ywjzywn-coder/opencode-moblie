import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { OpencodeClient } from "@opencode-ai/sdk/client";

export type RpcDispatcher = (method: string, args: unknown) => Promise<unknown>;

interface DbSession {
  id: string;
  title: string;
  projectID: string;
  directory: string;
  time: { created: number; updated: number };
}

let dbCache: DbSession[] | null = null;

function readAllSessionsFromDb(): DbSession[] {
  if (dbCache) return dbCache;
  const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db");
  if (!existsSync(dbPath)) return [];
  try {
    const output = execSync(
      `sqlite3 -json "${dbPath}" "SELECT s.id, s.title, s.project_id, p.worktree, s.time_created, s.time_updated FROM session s LEFT JOIN project p ON s.project_id = p.id ORDER BY s.time_updated DESC;"`,
      { timeout: 5000, encoding: "utf8" }
    );
    const rows = JSON.parse(output) as Array<{
      id: string; title: string | null; project_id: string;
      worktree: string | null; time_created: number; time_updated: number;
    }>;
    dbCache = rows.map((r) => ({
      id: r.id,
      title: r.title || "Untitled",
      projectID: r.project_id,
      directory: r.worktree || "/",
      time: { created: r.time_created, updated: r.time_updated },
    }));
    return dbCache;
  } catch {
    return [];
  }
}

export function invalidateDbCache(): void {
  dbCache = null;
}

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
    if (method === "db.session.list") {
      const sessions = readAllSessionsFromDb();
      return { data: sessions };
    }
    if (method === "db.invalidate") {
      invalidateDbCache();
      return true;
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
    return result;
  };
}
