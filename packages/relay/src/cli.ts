import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { resolve } from "node:path";
import { createServer } from "./server.js";
import { Store } from "./store.js";
import { DEFAULT_RELAY_PORT } from "@opencode-remote/shared";

async function loadOrCreateStore(statePath: string): Promise<Store> {
  const envToken = process.env.OPENCODE_REMOTE_USER_TOKEN;

  if (envToken) {
    const store = new Store(envToken);
    if (existsSync(statePath)) {
      await restoreMachines(store, statePath);
    }
    return store;
  }

  if (existsSync(statePath)) {
    const data = JSON.parse(await readFile(statePath, "utf8"));
    const store = new Store(data.userToken);
    for (const m of data.machines ?? []) {
      store.restoreMachine(m.id, m.name, m.machineToken);
    }
    return store;
  }

  const userToken = generateToken(32);
  const store = new Store(userToken);
  await persistStore(store, statePath);
  console.log("\n  No user token found. Generated a new one:");
  console.log(`  OPENCODE_REMOTE_USER_TOKEN=${userToken}\n`);
  return store;
}

async function restoreMachines(store: Store, statePath: string): Promise<void> {
  const data = JSON.parse(await readFile(statePath, "utf8"));
  for (const m of data.machines ?? []) {
    store.restoreMachine(m.id, m.name, m.machineToken);
  }
}

async function persistStore(store: Store, statePath: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  const data = {
    userToken: store.getUserToken(),
    machines: store.exportMachines(),
  };
  await writeFile(statePath, JSON.stringify(data, null, 2));
}

function generateToken(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}

async function main(): Promise<void> {
  const statePath = resolve(process.env.STATE_PATH ?? process.cwd(), ".relay-state.json");
  const [subcmd, ...rest] = process.argv.slice(2);

  if (subcmd === "machine-token") {
    const name = rest[0] ?? "default";
    const store = await loadOrCreateStore(statePath);
    const { machineId, machineToken } = store.createMachineToken(name);
    await persistStore(store, statePath);
    console.log(`  Machine created: ${name}`);
    console.log(`  Machine ID:    ${machineId}`);
    console.log(`  Machine token: ${machineToken}`);
    console.log(`\n  Run on the computer:`);
    console.log(`  opencode-remote-agent --token ${machineToken} --relay <relay-url>`);
    return;
  }

  const port = Number(process.env.PORT ?? DEFAULT_RELAY_PORT);
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";
  const staticDir = process.env.PWA_DIST
    ? resolve(process.env.PWA_DIST)
    : resolve(process.cwd(), "packages/pwa/dist");

  const store = await loadOrCreateStore(statePath);
  if (store.listMachines().length === 0) {
    const name = process.env.OPENCODE_REMOTE_MACHINE_NAME ?? osHostname();
    const { machineId, machineToken } = store.createMachineToken(name);
    await persistStore(store, statePath);
    console.log(`  Auto-created machine: ${name} (${machineId})`);
    console.log(`  Machine token: ${machineToken}`);
  }
  const { close } = createServer({
    port,
    hostname,
    store,
    onMachineChange: () => { persistStore(store, statePath); },
    staticDir,
  });

  console.log(`  Relay listening on http://${hostname}:${port}`);
  console.log(`  User token: ${store.getUserToken()}`);
  console.log(`  Machines registered: ${store.listMachines().length}`);
  if (existsSync(staticDir)) {
    console.log(`  PWA static files: ${staticDir}`);
  }

  const shutdown = () => {
    persistStore(store, statePath).finally(() => {
      close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
