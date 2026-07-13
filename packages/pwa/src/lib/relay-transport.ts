import type { ClientToRelayMessage, RelayToClientMessage, EventPayload } from "@opencode-remote/shared";

export interface RelayTransportOptions {
  url: string;
  userToken: string;
  machineId: string;
}

interface PendingRpc {
  reqId: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  onStream?: (chunk: unknown) => void;
}

export class RelayTransport {
  private ws: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, PendingRpc>();
  private reqCounter = 0;
  private machineListeners = new Set<(machines: MachineInfoLike[]) => void>();
  private eventListeners = new Set<(event: EventPayload) => void>();

  constructor(private opts: RelayTransportOptions) {}

  connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.send({ type: "auth", token: this.opts.userToken } as ClientToRelayMessage);
      });

      ws.addEventListener("message", (ev) => {
        let msg: RelayToClientMessage;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        this.handleMessage(msg, resolve, reject);
      });

      ws.addEventListener("close", () => {
        this.ws = null;
        this.ready = null;
        for (const [, p] of this.pending) p.reject(new Error("connection closed"));
        this.pending.clear();
      });

      ws.addEventListener("error", () => {
        reject(new Error(`无法连接到中继 ${this.opts.url}。请检查：1)手机和电脑在同一WiFi 2)中继地址正确 3)中继服务器正在运行`));
      });
    });
    return this.ready;
  }

  renameMachine(machineId: string, name: string): void {
    this.send({ type: "machine:rename", machineId, name } as ClientToRelayMessage);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.ready = null;
  }

  setMachineId(machineId: string): void {
    this.opts.machineId = machineId;
  }

  rpc(method: string, args: unknown): Promise<unknown> {
    return this.connect().then(() => this.doRpc(method, args));
  }

  onMachines(cb: (machines: MachineInfoLike[]) => void): () => void {
    this.machineListeners.add(cb);
    return () => this.machineListeners.delete(cb);
  }

  onEvent(cb: (event: EventPayload) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  private doRpc(method: string, args: unknown): Promise<unknown> {
    const reqId = `r${++this.reqCounter}`;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(reqId, { reqId, resolve, reject });
      this.send({
        type: "rpc",
        reqId,
        machineId: this.opts.machineId,
        method,
        args,
      } as ClientToRelayMessage);
    });
  }

  private handleMessage(
    msg: RelayToClientMessage,
    resolveAuth: () => void,
    rejectAuth: (e: Error) => void,
  ): void {
    switch (msg.type) {
      case "auth:ok":
        for (const l of this.machineListeners) l(msg.machines);
        resolveAuth();
        break;
      case "auth:error":
        rejectAuth(new Error(msg.message));
        break;
      case "machines":
        for (const l of this.machineListeners) l(msg.machines);
        break;
      case "event":
        for (const l of this.eventListeners) l(msg.event);
        break;
      case "rpc:resp": {
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
        break;
      }
      case "rpc:stream": {
        const p = this.pending.get(msg.reqId);
        if (p?.onStream) p.onStream(msg.chunk);
        break;
      }
      case "rpc:stream:end": {
        const p = this.pending.get(msg.reqId);
        if (p) {
          this.pending.delete(msg.reqId);
          p.resolve(undefined);
        }
        break;
      }
      case "pong":
        break;
    }
  }

  private send(msg: ClientToRelayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

interface MachineInfoLike {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: number;
  opencodeVersion?: string;
}
