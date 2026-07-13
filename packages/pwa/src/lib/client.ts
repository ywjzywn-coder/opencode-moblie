import type { RelayTransport } from "./relay-transport.js";
import type { createProxyClient } from "./rpc-client.js";

export type ProxyClient = ReturnType<typeof createProxyClient>;

export interface ConnectedSession {
  transport: RelayTransport;
  client: ProxyClient;
  machineId: string;
}
