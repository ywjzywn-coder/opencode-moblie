import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { networkInterfaces, homedir, hostname } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { PANEL_HTML } from "./panel-html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 项目根目录（panel/dist -> panel -> packages -> root）
const ROOT = resolve(__dirname, "..", "..", "..");

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 4099);
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 4097);
const OPENCODE_PORT = Number(process.env.OPENCODE_PORT ?? 4096);
const PWA_PORT = Number(process.env.PWA_PORT ?? 5173);

type ServiceName = "relay" | "opencode" | "daemon" | "pwa";

interface Service {
  name: ServiceName;
  label: string;
  proc: ChildProcess | null;
  status: "stopped" | "starting" | "running" | "error";
  log: string[];
}

const services: Record<ServiceName, Service> = {
  relay: { name: "relay", label: "中继服务器", proc: null, status: "stopped", log: [] },
  opencode: { name: "opencode", label: "opencode", proc: null, status: "stopped", log: [] },
  daemon: { name: "daemon", label: "守护进程", proc: null, status: "stopped", log: [] },
  pwa: { name: "pwa", label: "PWA", proc: null, status: "stopped", log: [] },
};

const binPath = `${homedir()}/.hermes/node/bin:${homedir()}/.opencode/bin`;
const env = { ...process.env, PATH: `${binPath}:${process.env.PATH ?? ""}` };

// opencode serve 密码（本次运行随机）
const ocPassword = `oc-remote-${randomBytes(6).toString("hex")}`;

function log(svc: Service, line: string): void {
  const clean = line.replace(/\n+$/, "");
  if (!clean) return;
  svc.log.push(clean);
  if (svc.log.length > 200) svc.log.shift();
}

function readState(): { userToken?: string; machineToken?: string } {
  const statePath = join(ROOT, ".relay-state.json");
  if (!existsSync(statePath)) return {};
  try {
    const s = JSON.parse(readFileSync(statePath, "utf8"));
    return { userToken: s.userToken, machineToken: s.machines?.[0]?.machineToken };
  } catch {
    return {};
  }
}

function getLanIp(): string {
  const ifaces = networkInterfaces();
  for (const name of ["en0", "en1", "eth0", "wlan0"]) {
    const list = ifaces[name];
    if (!list) continue;
    for (const i of list) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

function spawnService(svc: Service, cmd: string, args: string[], extraEnv: Record<string, string> = {}): void {
  if (svc.proc) return;
  svc.status = "starting";
  svc.log = [];
  const proc = spawn(cmd, args, { cwd: ROOT, env: { ...env, ...extraEnv } });
  svc.proc = proc;
  proc.stdout?.on("data", (d) => log(svc, d.toString()));
  proc.stderr?.on("data", (d) => log(svc, d.toString()));
  proc.on("spawn", () => { svc.status = "running"; });
  proc.on("error", (e) => { svc.status = "error"; log(svc, `spawn error: ${e.message}`); });
  proc.on("exit", (code) => {
    svc.status = code === 0 || code === null ? "stopped" : "error";
    svc.proc = null;
    log(svc, `exited with code ${code}`);
  });
}

function stopService(svc: Service): void {
  if (svc.proc) {
    svc.proc.kill("SIGTERM");
    svc.proc = null;
  }
  svc.status = "stopped";
}

function startRelay(): void {
  spawnService(services.relay, "node", ["packages/relay/dist/cli.js"]);
}

function startOpencode(): void {
  spawnService(services.opencode, "opencode", [
    "serve", "--port", String(OPENCODE_PORT), "--hostname", "127.0.0.1",
  ], { OPENCODE_SERVER_PASSWORD: ocPassword });
}

function startDaemon(): void {
  const { machineToken } = readState();
  if (!machineToken) {
    log(services.daemon, "缺少 machineToken（中继应自动创建；可执行: node packages/relay/dist/cli.js machine-token）");
    services.daemon.status = "error";
    return;
  }
  spawnService(services.daemon, "node", ["packages/plugin/dist/daemon.js"], {
    OPENCODE_REMOTE_RELAY_URL: `ws://127.0.0.1:${RELAY_PORT}`,
    OPENCODE_REMOTE_MACHINE_TOKEN: machineToken,
    OPENCODE_REMOTE_MACHINE_NAME: hostname(),
    OPENCODE_SERVER_PASSWORD: ocPassword,
  });
}

function startPwa(): void {
  spawnService(services.pwa, "pnpm", ["--filter", "@opencode-remote/pwa", "dev"]);
}

async function startAll(): Promise<void> {
  startRelay();
  await delay(1500);
  startOpencode();
  await delay(4000);
  startDaemon();
  await delay(1000);
  startPwa();
}

function stopAll(): void {
  for (const svc of Object.values(services)) stopService(svc);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 生成配对码：base64url({relayUrl, userToken}) */
function makePairingCode(): string | null {
  const { userToken } = readState();
  if (!userToken) return null;
  const ip = getLanIp();
  const payload = JSON.stringify({ relayUrl: `ws://${ip}:${RELAY_PORT}`, userToken });
  return Buffer.from(payload, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pwaUrlWithPairing(): string | null {
  const code = makePairingCode();
  if (!code) return null;
  const ip = getLanIp();
  return `http://${ip}:${PWA_PORT}/#pair=${code}`;
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://localhost`);
  if (url.pathname === "/api/status") {
    const state = readState();
    const body = {
      services: Object.values(services).map((s) => ({
        name: s.name, label: s.label, status: s.status, log: s.log.slice(-8),
      })),
      lanIp: getLanIp(),
      relayPort: RELAY_PORT,
      pwaPort: PWA_PORT,
      userToken: state.userToken ?? null,
      pairingCode: makePairingCode(),
      pwaUrl: pwaUrlWithPairing(),
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return true;
  }
  if (url.pathname === "/api/qr") {
    const target = pwaUrlWithPairing();
    if (!target) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("no pairing available");
      return true;
    }
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, width: 240 });
    res.writeHead(200, { "content-type": "image/svg+xml" });
    res.end(svg);
    return true;
  }
  if (url.pathname === "/api/start" && req.method === "POST") {
    startAll();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  if (url.pathname === "/api/stop" && req.method === "POST") {
    stopAll();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  if (url.pathname === "/api/restart" && req.method === "POST") {
    stopAll();
    setTimeout(() => { startAll(); }, 1500);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }
  return false;
}

function serveHtml(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PANEL_HTML);
}

const server = createServer(async (req, res) => {
  try {
    if (await handleApi(req, res)) return;
    serveHtml(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(e));
  }
});

server.listen(PANEL_PORT, () => {
  const panelUrl = `http://localhost:${PANEL_PORT}`;
  console.log(`\n  opencode-remote 控制面板: ${panelUrl}\n`);
  // 自动打开浏览器（macOS）
  spawn("open", [panelUrl], { env }).on("error", () => { /* ignore */ });
  // 自动启动全部服务
  startAll();
});

const shutdown = () => {
  console.log("\n正在停止全部服务...");
  stopAll();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
