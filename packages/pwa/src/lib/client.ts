import { RelayTransport } from "./relay-transport.js";
import { createProxyClient } from "./rpc-client.js";

export interface ConnectOptions {
  relayUrl: string;
  userToken: string;
  machineId: string;
}

export interface ConnectedSession {
  transport: RelayTransport;
  client: ReturnType<typeof createProxyClient>;
  machineId: string;
}

export function connect(opts: ConnectOptions): ConnectedSession {
  const transport = new RelayTransport({
    url: opts.relayUrl,
    userToken: opts.userToken,
    machineId: opts.machineId,
  });
  const client = createProxyClient(transport);
  return { transport, client, machineId: opts.machineId };
}

export type ProxyClient = ReturnType<typeof createProxyClient>;
