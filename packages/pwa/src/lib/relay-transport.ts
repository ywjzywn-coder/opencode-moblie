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
  private reconnectListeners = new Set<() => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private closedByUser = false;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hadConnection = false;

  constructor(private opts: RelayTransportOptions) {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.ensureConnected());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.ensureConnected();
      });
    }
  }

  connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.closedByUser = false;
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
        const wasConnected = this.hadConnection;
        this.ws = null;
        this.ready = null;
        this.hadConnection = false;
        for (const [, p] of this.pending) p.reject(new Error("connection closed"));
        this.pending.clear();
        for (const l of this.statusListeners) l(false);
        if (!this.closedByUser) {
          this.scheduleReconnect();
        }
        if (wasConnected) {
          // reject was already resolved once; nothing else to do here
        }
      });

      ws.addEventListener("error", () => {
        reject(new Error(`无法连接到中继 ${this.opts.url}。请检查：1)手机和电脑在同一WiFi 2)中继地址正确 3)中继服务器正在运行`));
      });
    });
    return this.ready;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser) return;
      this.connect()
        .then(() => {
          this.reconnectDelay = 1000;
          for (const l of this.reconnectListeners) l();
        })
        .catch(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
          this.scheduleReconnect();
        });
    }, this.reconnectDelay);
  }

  /** Call when the app comes back to foreground / network resumes, to reconnect immediately. */
  ensureConnected(): void {
    if (this.closedByUser) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectDelay = 1000;
    this.connect()
      .then(() => {
        for (const l of this.reconnectListeners) l();
      })
      .catch(() => this.scheduleReconnect());
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  renameMachine(machineId: string, name: string): void {
    this.send({ type: "machine:rename", machineId, name } as ClientToRelayMessage);
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

  /** Fired after a dropped connection is re-established, so views can resync missed state. */
  onReconnect(cb: () => void): () => void {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
  }

  /** Fired whenever the connected state changes. */
  onStatusChange(cb: (connected: boolean) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
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
        this.hadConnection = true;
        for (const l of this.machineListeners) l(msg.machines);
        for (const l of this.statusListeners) l(true);
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
