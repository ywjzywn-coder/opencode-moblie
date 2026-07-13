import { create } from "zustand";
import type { MachineInfo } from "@opencode-remote/shared";
import { RelayTransport } from "./relay-transport.js";
import { createProxyClient } from "./rpc-client.js";
import type { ConnectedSession, ProxyClient } from "./client.js";

export interface ConnectionConfig {
  relayUrl: string;
  userToken: string;
}

interface AppState {
  config: ConnectionConfig | null;
  machines: MachineInfo[];
  selectedMachineId: string | null;
  relayTransport: RelayTransport | null;
  session: ConnectedSession | null;
  connecting: boolean;
  error: string | null;

  setConfig: (config: ConnectionConfig) => void;
  connectToRelay: () => Promise<void>;
  selectMachine: (machineId: string) => void;
  renameMachine: (machineId: string, name: string) => void;
  disconnect: () => void;
  getClient: () => ProxyClient | null;
  getTransport: () => RelayTransport | null;
}

export const useStore = create<AppState>((set, get) => ({
  config: null,
  machines: [],
  selectedMachineId: null,
  relayTransport: null,
  session: null,
  connecting: false,
  error: null,

  setConfig: (config) => {
    set({ config });
    try {
      localStorage.setItem("oc-remote:config", JSON.stringify(config));
    } catch { /* ignore */ }
  },

  connectToRelay: async () => {
    const { config, relayTransport: existing } = get();
    if (!config) {
      set({ error: "No config set" });
      return;
    }
    if (existing) existing.disconnect();
    set({ connecting: true, error: null });
    try {
      const transport = new RelayTransport({
        url: config.relayUrl,
        userToken: config.userToken,
        machineId: "",
      });
      transport.onMachines((machines) => set({ machines }));
      await transport.connect();
      set({ relayTransport: transport, connecting: false });
    } catch (e) {
      set({ connecting: false, error: (e as Error).message });
    }
  },

  selectMachine: (machineId: string) => {
    const { relayTransport } = get();
    if (!relayTransport) return;
    relayTransport.setMachineId(machineId);
    const client = createProxyClient(relayTransport) as ProxyClient;
    set({ selectedMachineId: machineId, session: { transport: relayTransport, client, machineId } });
  },

  renameMachine: (machineId, name) => {
    const { relayTransport } = get();
    relayTransport?.renameMachine(machineId, name);
  },

  disconnect: () => {
    const { relayTransport } = get();
    relayTransport?.disconnect();
    set({ relayTransport: null, session: null, selectedMachineId: null, machines: [] });
  },

  getClient: () => {
    const { session } = get();
    return session?.client ?? null;
  },

  getTransport: () => {
    const { session } = get();
    return session?.transport ?? null;
  },
}));

export function loadStoredConfig(): ConnectionConfig | null {
  try {
    const raw = localStorage.getItem("oc-remote:config");
    if (!raw) return null;
    return JSON.parse(raw) as ConnectionConfig;
  } catch {
    return null;
  }
}

/** 把配对码（base64url 编码的 {relayUrl, userToken}）解析成连接配置 */
export function decodePairingCode(code: string): ConnectionConfig | null {
  try {
    const trimmed = code.trim();
    if (!trimmed) return null;
    // 兼容 base64url
    let b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(json) as Partial<ConnectionConfig>;
    if (parsed.relayUrl && parsed.userToken) {
      return { relayUrl: parsed.relayUrl, userToken: parsed.userToken };
    }
    return null;
  } catch {
    return null;
  }
}

/** 从 URL hash 里读取 #pair=xxx 配对码（iPhone 相机扫码后跳转过来） */
export function readPairingFromUrl(): ConnectionConfig | null {
  try {
    const hash = window.location.hash;
    const m = hash.match(/[#&]pair=([^&]+)/);
    if (!m) return null;
    const cfg = decodePairingCode(decodeURIComponent(m[1]));
    if (cfg) {
      // 清掉 hash，避免刷新时重复处理和泄露 token
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    return cfg;
  } catch {
    return null;
  }
}
