import { create } from "zustand";
import type { MachineInfo } from "@opencode-remote/shared";
import { RelayTransport } from "./relay-transport.js";
import { connect, type ConnectedSession, type ProxyClient } from "./client.js";

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
    const { config, relayTransport } = get();
    if (!config) return;
    const connected = connect({ ...config, machineId });
    if (relayTransport) {
      connected.transport.onMachines((machines) => set({ machines }));
    }
    set({ selectedMachineId: machineId, session: connected });
  },

  renameMachine: (machineId, name) => {
    const { relayTransport } = get();
    relayTransport?.renameMachine(machineId, name);
  },

  disconnect: () => {
    const { relayTransport, session } = get();
    relayTransport?.disconnect();
    session?.transport.disconnect();
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
