import { nanoid } from "nanoid";
import type { MachineInfo } from "@opencode-remote/shared";

export class Store {
  private userToken: string;
  private machines = new Map<string, MachineEntry>();

  constructor(userToken: string) {
    this.userToken = userToken;
  }

  getUserToken(): string {
    return this.userToken;
  }

  verifyUserToken(token: string): boolean {
    return timingSafeEqual(token, this.userToken);
  }

  createMachineToken(name: string): { machineId: string; machineToken: string } {
    const machineId = nanoid(12);
    const machineToken = nanoid(32);
    this.machines.set(machineId, {
      id: machineId,
      name,
      machineToken,
      online: false,
      lastSeenAt: 0,
    });
    return { machineId, machineToken };
  }

  verifyMachineToken(machineToken: string): MachineEntry | null {
    for (const m of this.machines.values()) {
      if (timingSafeEqual(machineToken, m.machineToken)) return m;
    }
    return null;
  }

  listMachines(): MachineInfo[] {
    return Array.from(this.machines.values()).map((m) => ({
      id: m.id,
      name: m.name,
      online: m.online,
      lastSeenAt: m.lastSeenAt,
      opencodeVersion: m.opencodeVersion,
    }));
  }

  getMachine(id: string): MachineEntry | undefined {
    return this.machines.get(id);
  }

  setOnline(machineId: string, opencodeVersion?: string): void {
    const m = this.machines.get(machineId);
    if (m) {
      m.online = true;
      m.lastSeenAt = Date.now();
      if (opencodeVersion) m.opencodeVersion = opencodeVersion;
    }
  }

  setOffline(machineId: string): void {
    const m = this.machines.get(machineId);
    if (m) m.online = false;
  }

  updateMachineName(machineId: string, name: string): boolean {
    const m = this.machines.get(machineId);
    if (!m) return false;
    m.name = name;
    return true;
  }

  removeMachine(machineId: string): void {
    this.machines.delete(machineId);
  }

  exportMachines(): Array<{ id: string; name: string; machineToken: string }> {
    return Array.from(this.machines.values()).map((m) => ({
      id: m.id,
      name: m.name,
      machineToken: m.machineToken,
    }));
  }

  restoreMachine(id: string, name: string, machineToken: string): void {
    this.machines.set(id, {
      id,
      name,
      machineToken,
      online: false,
      lastSeenAt: 0,
    });
  }
}

export interface MachineEntry {
  id: string;
  name: string;
  machineToken: string;
  online: boolean;
  lastSeenAt: number;
  opencodeVersion?: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
