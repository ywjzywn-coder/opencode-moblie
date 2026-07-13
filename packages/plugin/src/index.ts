import { hostname as osHostname } from "node:os";
import { RelayConnection } from "./relay-connection.js";
import { createRpcDispatcher } from "./rpc-dispatcher.js";
import type { OpencodeClient } from "@opencode-ai/sdk/client";

export interface RemotePluginConfig {
  relayUrl: string;
  machineToken: string;
  name?: string;
}

export interface PluginContext {
  project: unknown;
  client: OpencodeClient;
  directory: string;
  worktree: string;
}

const ENV_RELAY_URL = process.env.OPENCODE_REMOTE_RELAY_URL;
const ENV_MACHINE_TOKEN = process.env.OPENCODE_REMOTE_MACHINE_TOKEN;
const ENV_MACHINE_NAME = process.env.OPENCODE_REMOTE_MACHINE_NAME;

function getConfig(): RemotePluginConfig | null {
  const relayUrl = ENV_RELAY_URL;
  const machineToken = ENV_MACHINE_TOKEN;
  if (!relayUrl || !machineToken) return null;
  return { relayUrl, machineToken, name: ENV_MACHINE_NAME };
}

export const RemotePlugin = async (ctx: PluginContext) => {
  const config = getConfig();
  if (!config) {
    console.error("[opencode-remote] Not configured. Set OPENCODE_REMOTE_RELAY_URL and OPENCODE_REMOTE_MACHINE_TOKEN env vars.");
    return {};
  }

  const { relayUrl, machineToken, name } = config;
  const machineName = name ?? osHostname();
  const client = ctx.client;

  let opencodeVersion: string | undefined;
  try {
    const config = await client.config.get();
    opencodeVersion = (config.data as { version?: string })?.version;
  } catch { /* ignore */ }

  const dispatcher = createRpcDispatcher(client);

  const connection = new RelayConnection({
    url: relayUrl,
    machineToken,
    name: machineName,
    opencodeVersion,
    onRegistered: (machineId) => {
      console.log(`[opencode-remote] Registered as machine ${machineId} (${machineName})`);
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
  console.log(`[opencode-remote] Connecting to relay at ${relayUrl}`);

  const forwardEvents = [
    "session.idle",
    "session.error",
    "session.status",
    "session.created",
    "session.updated",
    "session.deleted",
    "session.diff",
    "message.updated",
    "message.part.updated",
    "message.removed",
    "message.part.removed",
    "permission.asked",
    "permission.replied",
    "todo.updated",
    "file.edited",
    "tool.execute.before",
    "tool.execute.after",
  ];

  const hooks: Record<string, unknown> = {};

  for (const eventType of forwardEvents) {
    hooks[eventType] = async (input: unknown, output: unknown) => {
      try {
        connection.sendEvent({
          type: eventType,
          properties: { input, output },
        });
      } catch { /* ignore send errors */ }
    };
  }

  hooks["event"] = async ({ event }: { event: { type: string; properties: unknown } }) => {
    try {
      connection.sendEvent({
        type: event.type,
        properties: event.properties as Record<string, unknown>,
      });
    } catch { /* ignore */ }
    };

  return hooks;
};

export default RemotePlugin;
