import { useEffect, useState } from "react";
import { useStore } from "../lib/store.js";

interface AgentInfo {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  builtIn: boolean;
}

const AGENT_ICONS: Record<string, string> = {
  build: "🔨",
  plan: "📋",
  explore: "🔍",
  general: "🤖",
  compaction: "📦",
  summary: "📝",
  title: "🏷️",
};

interface Props {
  current: string | null;
  onSelect: (agent: string) => void;
  onClose: () => void;
}

export function AgentSelector({ current, onSelect, onClose }: Props) {
  const getClient = useStore((s) => s.getClient);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = getClient();
    if (!client) return;
    (async () => {
      try {
        const res = await (client as any).app.agents();
        if (res.error) throw new Error(res.error.message);
        const all = (res.data ?? []) as AgentInfo[];
        setAgents(all.filter((a) => a.mode === "primary" || a.mode === "all"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [getClient]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div style={{ background: "var(--bg-panel)", width: "100%", maxHeight: "70vh", overflowY: "auto", borderRadius: "20px 20px 0 0", padding: 16, paddingBottom: "calc(16px + var(--safe-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>选择 Agent / 模式</span>
          <button className="back-btn" onClick={onClose}>✕</button>
        </div>
        {loading && <div className="muted"><span className="spinner" /> 加载中...</div>}
        {error && <div className="error-text">{error}</div>}
        <div
          className="list-item"
          onClick={() => { onSelect(""); onClose(); }}
          style={!current ? { borderColor: "var(--primary)" } : undefined}
        >
          <div style={{ fontSize: 20, flexShrink: 0 }}>⚙️</div>
          <div className="meta">
            <div className="name">默认</div>
            <div className="sub">使用 opencode 当前默认 agent</div>
          </div>
          {!current && <span style={{ color: "var(--primary)", flexShrink: 0 }}>✓</span>}
        </div>
        {agents.map((a) => {
          const isCurrent = current === a.name;
          const icon = AGENT_ICONS[a.name.toLowerCase()] ?? "🤖";
          return (
            <div
              key={a.name}
              className="list-item"
              onClick={() => { onSelect(a.name); onClose(); }}
              style={isCurrent ? { borderColor: "var(--primary)" } : undefined}
            >
              <div style={{ fontSize: 20, flexShrink: 0 }}>{icon}</div>
              <div className="meta">
                <div className="name">{a.name}</div>
                <div className="sub">{a.description ?? a.mode}</div>
              </div>
              {isCurrent && <span style={{ color: "var(--primary)", flexShrink: 0 }}>✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
