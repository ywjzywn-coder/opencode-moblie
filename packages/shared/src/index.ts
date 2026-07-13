export const DEFAULT_RELAY_PORT = 4097 as const;
export const HEARTBEAT_INTERVAL_MS = 15000 as const;

export interface MachineInfo {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: number;
  opencodeVersion?: string;
}

export interface EventPayload {
  type: string;
  properties: Record<string, unknown>;
}

export type ClientToRelayMessage =
  | { type: "auth"; token: string }
  | { type: "rpc"; reqId: string; machineId: string; method: string; args: unknown }
  | { type: "rpc:cancel"; reqId: string }
  | { type: "machine:rename"; machineId: string; name: string }
  | { type: "ping" };

export type MachineToRelayMessage =
  | { type: "register"; machineToken: string; name: string; opencodeVersion?: string }
  | { type: "rpc:resp"; reqId: string; result?: unknown; error?: string }
  | { type: "rpc:stream"; reqId: string; chunk: unknown }
  | { type: "rpc:stream:end"; reqId: string }
  | { type: "event"; event: EventPayload }
  | { type: "pong" };

export type RelayToClientMessage =
  | { type: "auth:ok"; machines: MachineInfo[] }
  | { type: "auth:error"; message: string }
  | { type: "machines"; machines: MachineInfo[] }
  | { type: "rpc:resp"; reqId: string; result?: unknown; error?: string }
  | { type: "rpc:stream"; reqId: string; chunk: unknown }
  | { type: "rpc:stream:end"; reqId: string }
  | { type: "event"; event: EventPayload }
  | { type: "pong" };

export type RelayToMachineMessage =
  | { type: "registered"; machineId: string }
  | { type: "register:error"; message: string }
  | { type: "rpc"; reqId: string; method: string; args: unknown }
  | { type: "rpc:cancel"; reqId: string }
  | { type: "ping" };

export type AnyMessage =
  | ClientToRelayMessage
  | MachineToRelayMessage
  | RelayToClientMessage
  | RelayToMachineMessage;

export function isClientToRelay(m: AnyMessage): m is ClientToRelayMessage {
  return (m as ClientToRelayMessage).type === "auth"
    || (m as ClientToRelayMessage).type === "rpc"
    || (m as ClientToRelayMessage).type === "rpc:cancel"
    || (m as ClientToRelayMessage).type === "machine:rename"
    || (m as ClientToRelayMessage).type === "ping";
}

export function isMachineToRelay(m: AnyMessage): m is MachineToRelayMessage {
  return (m as MachineToRelayMessage).type === "register"
    || (m as MachineToRelayMessage).type === "rpc:resp"
    || (m as MachineToRelayMessage).type === "rpc:stream"
    || (m as MachineToRelayMessage).type === "rpc:stream:end"
    || (m as MachineToRelayMessage).type === "event"
    || (m as MachineToRelayMessage).type === "pong";
}

export function parseMessage(data: unknown): AnyMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (typeof m.type !== "string") return null;
  return m as unknown as AnyMessage;
}
