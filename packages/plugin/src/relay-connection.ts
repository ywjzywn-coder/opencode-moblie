import {
  HEARTBEAT_INTERVAL_MS,
  type MachineToRelayMessage,
  type RelayToMachineMessage,
  type EventPayload,
} from "@opencode-remote/shared";

type WsLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  terminate?(): void;
  on(event: string, handler: (...args: any[]) => void): void;
};

const WS_OPEN = 1;

function createWs(url: string): WsLike {
  if (typeof WebSocket !== "undefined") {
    const ws = new WebSocket(url);
    return {
      get readyState() { return ws.readyState; },
      send: (d: string) => ws.send(d),
      close: () => ws.close(),
      on: (ev: string, handler: (...args: any[]) => void) => {
        if (ev === "open") (ws as any).addEventListener("open", handler);
        else if (ev === "message") (ws as any).addEventListener("message", (e: any) => handler(e.data));
        else if (ev === "close") (ws as any).addEventListener("close", handler);
        else if (ev === "error") (ws as any).addEventListener("error", handler);
      },
      terminate: () => ws.close(),
    };
  }
  throw new Error("No WebSocket implementation available");
}

export interface RelayConnectionOptions {
  url: string;
  machineToken: string;
  name: string;
  opencodeVersion?: string;
  onRegistered?: (machineId: string) => void;
  onRpc: (reqId: string, method: string, args: unknown) => void;
  onRpcCancel?: (reqId: string) => void;
}

export class RelayConnection {
  private ws: WsLike | null = null;
  private alive = false;
  private reconnectDelay = 1000;
  private closed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: RelayConnectionOptions) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
  }

  sendRpcResp(reqId: string, result?: unknown, error?: string): void {
    this.send({ type: "rpc:resp", reqId, result, error } as MachineToRelayMessage);
  }

  sendRpcStream(reqId: string, chunk: unknown): void {
    this.send({ type: "rpc:stream", reqId, chunk } as MachineToRelayMessage);
  }

  sendRpcStreamEnd(reqId: string): void {
    this.send({ type: "rpc:stream:end", reqId } as MachineToRelayMessage);
  }

  sendEvent(event: EventPayload): void {
    this.send({ type: "event", event } as MachineToRelayMessage);
  }

  private connect(): void {
    if (this.closed) return;
    let ws: WsLike;
    try {
      ws = createWs(this.opts.url);
    } catch (e) {
      console.error("[opencode-remote] WebSocket creation failed:", (e as Error).message);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.alive = true;
      this.reconnectDelay = 1000;
      this.send({
        type: "register",
        machineToken: this.opts.machineToken,
        name: this.opts.name,
        opencodeVersion: this.opts.opencodeVersion,
      } as MachineToRelayMessage);
      this.startHeartbeat();
    });

    ws.on("message", (data: string) => {
      let msg: RelayToMachineMessage;
      try {
        msg = JSON.parse(typeof data === "string" ? data : (data as any).toString());
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    ws.on("close", () => {
      this.stopHeartbeat();
      if (!this.closed) {
        console.error(`[opencode-remote] disconnected, reconnecting in ${this.reconnectDelay}ms`);
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      }
    });

    ws.on("error", (err: any) => {
      console.error("[opencode-remote] ws error:", err?.message ?? err);
    });
  }

  private handleMessage(msg: RelayToMachineMessage): void {
    switch (msg.type) {
      case "registered":
        this.opts.onRegistered?.(msg.machineId);
        break;
      case "register:error":
        console.error("[opencode-remote] register failed:", msg.message);
        break;
      case "ping":
        this.alive = true;
        this.send({ type: "pong" } as MachineToRelayMessage);
        break;
      case "rpc":
        this.opts.onRpc(msg.reqId, msg.method, msg.args);
        break;
      case "rpc:cancel":
        this.opts.onRpcCancel?.(msg.reqId);
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.alive) {
        this.ws?.close();
        return;
      }
      this.alive = false;
      this.send({ type: "pong" } as MachineToRelayMessage);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(msg: MachineToRelayMessage): void {
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
