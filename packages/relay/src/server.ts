import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  HEARTBEAT_INTERVAL_MS,
  parseMessage,
  isClientToRelay,
  isMachineToRelay,
  type ClientToRelayMessage,
  type MachineToRelayMessage,
  type RelayToClientMessage,
  type RelayToMachineMessage,
  type EventPayload,
} from "@opencode-remote/shared";
import { Store } from "./store.js";

interface ClientConn {
  ws: WebSocket;
  alive: boolean;
}

interface MachineConn {
  ws: WebSocket;
  machineId: string;
  alive: boolean;
  pendingRequests: Set<string>;
}

export interface ServerOptions {
  port: number;
  hostname: string;
  store: Store;
  onMachineChange?: () => void;
  staticDir?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function serveStatic(rootDir: string, req: IncomingMessage, res: ServerResponse): void {
  let urlPath = req.url ?? "/";
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = normalize(join(rootDir, urlPath));

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = join(rootDir, "index.html");
    if (existsSync(fallback)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(fallback));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
    return;
  }

  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": mime });
  res.end(readFileSync(filePath));
}

export function createServer(opts: ServerOptions): { wss: WebSocketServer; close: () => void } {
  const { port, hostname, store, staticDir } = opts;

  const httpServer = createHttpServer((req, res) => {
    if (staticDir && existsSync(staticDir)) {
      serveStatic(staticDir, req, res);
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><h1>OpenCode Remote Relay</h1><p>WebSocket server running.</p></body></html>");
    }
  });

  const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: true });

  const clients = new Set<ClientConn>();
  const machines = new Map<string, MachineConn>();

  const heartbeatTimer = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      send(c.ws, { type: "pong" });
    }
    for (const [id, m] of machines) {
      if (!m.alive) {
        store.setOffline(id);
        machines.delete(id);
        broadcastMachines();
        m.ws.terminate();
        continue;
      }
      m.alive = false;
      send(m.ws, { type: "ping" } as RelayToMachineMessage);
    }
  }, HEARTBEAT_INTERVAL_MS);

  function broadcastMachines(): void {
    const machinesList = store.listMachines();
    for (const c of clients) {
      send(c.ws, { type: "machines", machines: machinesList } as RelayToClientMessage);
    }
  }

  function broadcastEvent(event: EventPayload): void {
    for (const c of clients) {
      send(c.ws, { type: "event", event } as RelayToClientMessage);
    }
  }

  wss.on("connection", (ws) => {
    let role: "client" | "machine" | null = null;
    let clientConn: ClientConn | null = null;
    let machineConn: MachineConn | null = null;

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.close(4001, "invalid json");
        return;
      }
      const msg = parseMessage(parsed);
      if (!msg) {
        ws.close(4002, "invalid message");
        return;
      }

      if (role === null) {
        if (isClientToRelay(msg) && msg.type === "auth") {
          if (!store.verifyUserToken(msg.token)) {
            send(ws, { type: "auth:error", message: "invalid user token" });
            ws.close(4003, "auth failed");
            return;
          }
          role = "client";
          clientConn = { ws, alive: true };
          clients.add(clientConn);
          send(ws, { type: "auth:ok", machines: store.listMachines() });
          return;
        }
        if (isMachineToRelay(msg) && msg.type === "register") {
          const entry = store.verifyMachineToken(msg.machineToken);
          if (!entry) {
            send(ws, { type: "register:error", message: "invalid machine token" });
            ws.close(4003, "register failed");
            return;
          }
          role = "machine";
          machineConn = {
            ws,
            machineId: entry.id,
            alive: true,
            pendingRequests: new Set(),
          };
          machines.set(entry.id, machineConn);
          store.setOnline(entry.id, msg.opencodeVersion);
          send(ws, { type: "registered", machineId: entry.id });
          broadcastMachines();
          return;
        }
        ws.close(4004, "must auth or register first");
        return;
      }

      if (role === "client" && clientConn) {
        handleClientMessage(msg as ClientToRelayMessage, clientConn);
        return;
      }
      if (role === "machine" && machineConn) {
        handleMachineMessage(msg as MachineToRelayMessage, machineConn);
        return;
      }
    });

    ws.on("pong", () => {
      if (clientConn) clientConn.alive = true;
      if (machineConn) machineConn.alive = true;
    });

    ws.on("close", () => {
      if (clientConn) clients.delete(clientConn);
      if (machineConn) {
        store.setOffline(machineConn.machineId);
        machines.delete(machineConn.machineId);
        broadcastMachines();
      }
    });

    ws.on("error", () => {
      try { ws.terminate(); } catch { /* noop */ }
    });
  });

  function handleClientMessage(msg: ClientToRelayMessage, conn: ClientConn): void {
    switch (msg.type) {
      case "ping":
        send(conn.ws, { type: "pong" });
        break;
      case "rpc":
        forwardRpc(msg, conn);
        break;
      case "rpc:cancel":
        cancelRpc(msg.reqId);
        break;
      case "machine:rename":
        if (store.updateMachineName(msg.machineId, msg.name)) {
          broadcastMachines();
          opts.onMachineChange?.();
        }
        break;
    }
  }

  function forwardRpc(msg: ClientToRelayMessage, conn: ClientConn): void {
    if (msg.type !== "rpc") return;
    const machine = machines.get(msg.machineId);
    if (!machine) {
      send(conn.ws, {
        type: "rpc:resp",
        reqId: msg.reqId,
        error: "machine offline or unknown",
      });
      return;
    }
    machine.pendingRequests.add(msg.reqId);
    send(machine.ws, {
      type: "rpc",
      reqId: msg.reqId,
      method: msg.method,
      args: msg.args,
    } as RelayToMachineMessage);
  }

  function cancelRpc(reqId: string): void {
    for (const m of machines.values()) {
      if (m.pendingRequests.has(reqId)) {
        m.pendingRequests.delete(reqId);
        send(m.ws, { type: "rpc:cancel", reqId } as RelayToMachineMessage);
      }
    }
  }

  function handleMachineMessage(msg: MachineToRelayMessage, conn: MachineConn): void {
    switch (msg.type) {
      case "pong":
        conn.alive = true;
        break;
      case "rpc:resp":
        conn.pendingRequests.delete(msg.reqId);
        forwardToClients(msg);
        break;
      case "rpc:stream":
        forwardToClients(msg);
        break;
      case "rpc:stream:end":
        conn.pendingRequests.delete(msg.reqId);
        forwardToClients(msg);
        break;
      case "event":
        broadcastEvent(msg.event);
        break;
    }
  }

  function forwardToClients(msg: MachineToRelayMessage): void {
    for (const c of clients) {
      if (msg.type === "rpc:resp") {
        send(c.ws, { type: "rpc:resp", reqId: msg.reqId, result: msg.result, error: msg.error } as RelayToClientMessage);
      } else if (msg.type === "rpc:stream") {
        send(c.ws, { type: "rpc:stream", reqId: msg.reqId, chunk: msg.chunk } as RelayToClientMessage);
      } else if (msg.type === "rpc:stream:end") {
        send(c.ws, { type: "rpc:stream:end", reqId: msg.reqId } as RelayToClientMessage);
      }
    }
  }

  function send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function close(): void {
    clearInterval(heartbeatTimer);
    for (const c of clients) c.ws.terminate();
    for (const m of machines.values()) m.ws.terminate();
    wss.close();
    httpServer.close();
  }

  httpServer.listen(port, hostname);

  return { wss, close };
}
