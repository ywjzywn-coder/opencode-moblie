import { hostname as osHostname } from "node:os";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { RelayConnection } from "./relay-connection.js";
import { createRpcDispatcher } from "./rpc-dispatcher.js";

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
        const result = await dispatcher(method, args);
        connection.sendRpcResp(reqId, result);
      } catch (err) {
        connection.sendRpcResp(reqId, undefined, (err as Error).message);
      }
    },
  });

  connection.start();

  let eventStream: AsyncIterable<{ type: string; properties: unknown }> | null = null;
  let eventLoopRunning = false;

  async function startEventLoop() {
    if (eventLoopRunning) return;
    eventLoopRunning = true;
    try {
      const result = await client.event.subscribe();
      eventStream = result as unknown as AsyncIterable<{ type: string; properties: unknown }>;
      if (eventStream && typeof (eventStream as any)[Symbol.asyncIterator] === "function") {
        for await (const event of eventStream as any) {
          try {
            connection.sendEvent({
              type: event.type,
              properties: event.properties as Record<string, unknown>,
            });
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      console.error("[opencode-remote] 事件流错误:", (e as Error).message);
    } finally {
      eventLoopRunning = false;
    }
  }

  startEventLoop();

  const shutdown = () => {
    console.log("\n[opencode-remote] 正在关闭...");
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
