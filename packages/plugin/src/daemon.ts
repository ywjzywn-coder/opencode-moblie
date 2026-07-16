import { hostname as osHostname } from "node:os";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { RelayConnection } from "./relay-connection.js";
import {
  createRpcDispatcher,
  extractDirectoryFromArgs,
  listSessionDirectories,
} from "./rpc-dispatcher.js";

interface DaemonConfig {
  relayUrl?: string;
  machineToken?: string;
  machineName?: string;
  opencodeUrl?: string;
}

function loadConfigFile(): DaemonConfig {
  const configPath = join(homedir(), ".config", "opencode", "remote.json");
  if (!existsSync(configPath)) return {};
  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as DaemonConfig;
  } catch {
    console.error(`[opencode-remote] 配置文件解析失败: ${configPath}`);
    return {};
  }
}

async function main(): Promise<void> {
  const fileConfig = loadConfigFile();

  const relayUrl = process.env.OPENCODE_REMOTE_RELAY_URL ?? fileConfig.relayUrl ?? "ws://127.0.0.1:4097";
  const machineToken = process.env.OPENCODE_REMOTE_MACHINE_TOKEN ?? fileConfig.machineToken;
  const machineName = process.env.OPENCODE_REMOTE_MACHINE_NAME ?? fileConfig.machineName ?? osHostname();
  const opencodeUrl = process.env.OPENCODE_REMOTE_OPENCODE_URL ?? fileConfig.opencodeUrl ?? "http://127.0.0.1:4096";
  const opencodePassword = process.env.OPENCODE_SERVER_PASSWORD;

  if (!machineToken) {
    console.error("[opencode-remote] 缺少 machineToken");
    console.error("  请运行 ./setup.sh 生成配置，或设置 OPENCODE_REMOTE_MACHINE_TOKEN 环境变量");
    process.exit(1);
  }

  console.log(`[opencode-remote] 连接 opencode: ${opencodeUrl}`);
  console.log(`[opencode-remote] 连接中继: ${relayUrl}`);
  console.log(`[opencode-remote] 机器名称: ${machineName}`);

  const fetchWithAuth = opencodePassword
    ? (req: Request) => {
        const headers = new Headers(req.headers);
        headers.set("authorization", "Basic " + Buffer.from(`opencode:${opencodePassword}`).toString("base64"));
        return fetch(new Request(req.url, { method: req.method, headers, body: req.body, duplex: "half" }));
      }
    : undefined;

  const client = createOpencodeClient({
    baseUrl: opencodeUrl,
    ...(fetchWithAuth ? { fetch: fetchWithAuth } : {}),
  });

  let opencodeVersion: string | undefined;
  try {
    const health = await client.config.get();
    opencodeVersion = (health.data as { version?: string })?.version;
  } catch { /* ignore */ }

  const dispatcher = createRpcDispatcher(client);
  let stopped = false;

  const connection = new RelayConnection({
    url: relayUrl,
    machineToken,
    name: machineName,
    opencodeVersion,
    onRegistered: (machineId) => {
      console.log(`[opencode-remote] 已注册为中继机器 ${machineId} (${machineName})`);
    },
    onRpc: async (reqId, method, args) => {
      try {
        const dir = extractDirectoryFromArgs(args);
        if (dir) ensureEventLoop(dir);
        const result = await dispatcher(method, args);
        connection.sendRpcResp(reqId, result);
      } catch (err) {
        connection.sendRpcResp(reqId, undefined, (err as Error).message);
      }
    },
  });

  connection.start();

  // opencode 的 /event 按 directory 分实例：
  // 默认 /event 只覆盖 serve 启动目录；跨项目会话的 message/session 事件
  // 只出现在 /event?directory=<path>。只订默认流会导致手机“发得出、收不到回复”。
  const baseEventUrl = opencodeUrl.replace(/\/$/, "") + "/event";
  const authHeader = opencodePassword
    ? "Basic " + Buffer.from(`opencode:${opencodePassword}`).toString("base64")
    : undefined;

  const loops = new Map<string, { running: boolean }>();

  function eventUrlFor(directory?: string): string {
    if (!directory) return baseEventUrl;
    return `${baseEventUrl}?directory=${encodeURIComponent(directory)}`;
  }

  function loopKey(directory?: string): string {
    return directory ?? "";
  }

  function ensureEventLoop(directory?: string): void {
    const key = loopKey(directory);
    if (loops.has(key)) return;
    const state = { running: false };
    loops.set(key, state);
    console.log(`[opencode-remote] 订阅事件流: ${directory ? directory : "(default)"}`);
    void runEventLoop(directory, state);
  }

  async function runEventLoop(directory: string | undefined, state: { running: boolean }): Promise<void> {
    if (state.running || stopped) return;
    state.running = true;
    const url = eventUrlFor(directory);
    try {
      const res = await fetch(url, {
        headers: authHeader ? { authorization: authHeader } : {},
      });
      if (!res.ok || !res.body) {
        throw new Error(`/event 响应异常: ${res.status} dir=${directory ?? "default"}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let event: { type?: string; properties?: unknown };
          try {
            event = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (!event.type) continue;
          // 各 directory 流都会推 server.heartbeat / server.connected，只转发一份默认流的
          if (
            (event.type === "server.heartbeat" || event.type === "server.connected")
            && directory
          ) {
            continue;
          }
          try {
            connection.sendEvent({
              type: event.type,
              properties: (event.properties ?? {}) as Record<string, unknown>,
            });
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      if (!stopped) {
        console.error(
          `[opencode-remote] 事件流错误 (${directory ?? "default"}):`,
          (e as Error).message,
        );
      }
    } finally {
      state.running = false;
      if (!stopped) {
        setTimeout(() => { void runEventLoop(directory, state); }, 1000);
      }
    }
  }

  ensureEventLoop(undefined);
  for (const dir of listSessionDirectories()) {
    ensureEventLoop(dir);
  }
  setInterval(() => {
    if (stopped) return;
    try {
      for (const dir of listSessionDirectories()) ensureEventLoop(dir);
    } catch { /* ignore */ }
  }, 30_000);

  const shutdown = () => {
    console.log("\n[opencode-remote] 正在关闭...");
    stopped = true;
    connection.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
